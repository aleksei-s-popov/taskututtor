// Account mode: sign-in (Clerk), the API client and sync with the Taskututtor server.
//
// This whole module is optional. It is active only in builds that set VITE_API_URL and
// VITE_CLERK_PUBLISHABLE_KEY; without them the app is the plain personal-key version and
// none of this code (nor Clerk's) is ever loaded.

import type { Chapter, Series, Settings, State } from "./store";

// Base URL of the server; "/" means the server that also serves this app.
const RAW_API = import.meta.env.VITE_API_URL as string | undefined;
const API = (RAW_API ?? "").replace(/\/+$/, "");
const CLERK_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
/** Local development against `wrangler dev` with DEV_AUTH=1: signs in as this name without Clerk. */
const DEV_USER = import.meta.env.VITE_DEV_USER as string | undefined;

export const cloudAvailable = !!RAW_API && (!!CLERK_KEY || !!DEV_USER);

/** Settings that follow the reader between devices (keys and models never leave the device). */
const SYNCED: (keyof Settings)[] = ["onboarded", "lang", "level", "interests", "yki", "fontSize", "listenGap", "listenRate", "illustrations"];

/** Chapter fields the reader changes; everything else is written by the server. */
const PROGRESS: (keyof Chapter)[] = ["lookedUp", "peeked", "answers", "finished", "feedback", "levelDelta", "glossary"];

interface ClerkLike {
  load(): Promise<void>;
  user?: { id: string; primaryEmailAddress?: { emailAddress: string } | null } | null;
  session?: { getToken(): Promise<string | null> } | null;
  openSignIn(opts?: Record<string, unknown>): void;
  signOut(): Promise<void>;
  addListener(cb: () => void): void;
}

let clerk: ClerkLike | null = null;
let devSignedIn = false;

export function userId(): string | null {
  if (DEV_USER) return devSignedIn ? `dev:${DEV_USER}` : null;
  return clerk?.user?.id ?? null;
}

export function userLabel(): string {
  if (DEV_USER) return `${DEV_USER} (development)`;
  return clerk?.user?.primaryEmailAddress?.emailAddress ?? "your account";
}

/** Loads the sign-in library and reports whenever the signed-in reader changes. */
export async function initAuth(onChange: () => void): Promise<void> {
  if (!cloudAvailable) return;
  if (DEV_USER) {
    devSignedIn = localStorage.getItem("taskututtor.dev-signed-in") === "1";
    devChange = onChange;
    return;
  }
  const { Clerk } = await import("@clerk/clerk-js");
  clerk = new Clerk(CLERK_KEY!) as unknown as ClerkLike;
  await clerk.load();
  let last = userId();
  clerk.addListener(() => {
    if (userId() !== last) {
      last = userId();
      onChange();
    }
  });
}

let devChange: (() => void) | null = null;

export function signIn(): void {
  if (DEV_USER) {
    devSignedIn = true;
    localStorage.setItem("taskututtor.dev-signed-in", "1");
    devChange?.();
    return;
  }
  clerk?.openSignIn({});
}

export async function signOut(): Promise<void> {
  if (DEV_USER) {
    devSignedIn = false;
    localStorage.removeItem("taskututtor.dev-signed-in");
    devChange?.();
    return;
  }
  await clerk?.signOut();
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function token(): Promise<string> {
  if (DEV_USER) return `dev:${DEV_USER}`;
  const t = await clerk?.session?.getToken();
  if (!t) throw new ApiError(401, "Your session has expired. Sign in again.");
  return t;
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${await token()}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    });
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, "Couldn't reach the server. Check your connection.");
  }
  if (!res.ok) {
    const detail = await res
      .json()
      .then((j) => String(j?.error ?? ""))
      .catch(() => "");
    throw new ApiError(res.status, detail || `The server answered with an error (${res.status}).`);
  }
  return res;
}

export async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await request(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  return (await res.json()) as T;
}

/** Downloads a chapter's illustration as a data URL. */
export async function fetchImage(chapterId: string): Promise<string> {
  const blob = await (await request(`/api/images/${chapterId}`)).blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("The illustration could not be read."));
    r.readAsDataURL(blob);
  });
}

// ---------- sync ----------

interface Remote {
  now: number;
  profile: { data: Record<string, unknown>; updatedAt: number } | null;
  series: { id: string; deleted: boolean; data: Omit<Series, "chapters"> }[];
  chapters: { id: string; seriesId: string; idx: number; data: Chapter }[];
}

function profileOf(state: State): Record<string, unknown> {
  const out: Record<string, unknown> = { words: state.words };
  for (const k of SYNCED) out[k] = state.settings[k];
  return out;
}

/** Sends this device's unsent changes (profile and chapter progress) to the server. */
export async function push(state: State): Promise<void> {
  const sync = (state.sync ??= { lastSync: 0, dirtyProfile: false, dirtyChapters: [] });
  if (sync.dirtyProfile) {
    sync.dirtyProfile = false;
    try {
      await api("/api/profile", "PUT", profileOf(state));
    } catch (e) {
      sync.dirtyProfile = true;
      throw e;
    }
  }
  for (const id of [...sync.dirtyChapters]) {
    const ch = state.series.flatMap((s) => s.chapters).find((c) => c.id === id);
    sync.dirtyChapters = sync.dirtyChapters.filter((x) => x !== id);
    if (!ch) continue;
    const patch: Record<string, unknown> = {};
    for (const f of PROGRESS) patch[f] = ch[f];
    try {
      await api(`/api/chapters/${id}`, "PUT", patch);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) {
        sync.dirtyChapters.push(id);
        throw e;
      }
    }
  }
}

/**
 * Fetches what changed on the server since the last pull and merges it into `state`.
 * Unsent local changes win over what comes back. Returns true when anything changed.
 */
export async function pull(state: State): Promise<boolean> {
  const sync = (state.sync ??= { lastSync: 0, dirtyProfile: false, dirtyChapters: [] });
  const first = sync.lastSync === 0;
  const remote = await api<Remote>(`/api/state?since=${sync.lastSync}`);
  let changed = false;

  if (remote.profile && !sync.dirtyProfile) {
    const p = remote.profile.data;
    for (const k of SYNCED) if (p[k] !== undefined) (state.settings as unknown as Record<string, unknown>)[k] = p[k];
    if (p.words) state.words = p.words as State["words"];
    changed = true;
  } else if (first && !remote.profile) {
    // A brand-new account: start it from what this reader already set up on the device.
    sync.dirtyProfile = true;
  }

  for (const r of remote.series) {
    const i = state.series.findIndex((s) => s.id === r.id);
    if (r.deleted) {
      if (i >= 0) state.series.splice(i, 1);
    } else if (i >= 0) {
      state.series[i] = { ...r.data, id: r.id, chapters: state.series[i].chapters };
    } else {
      state.series.push({ ...r.data, id: r.id, chapters: [] });
    }
    changed = true;
  }

  for (const r of remote.chapters) {
    const series = state.series.find((s) => s.id === r.seriesId);
    if (!series) continue;
    const local = series.chapters.find((c) => c.id === r.id);
    const next = { ...r.data };
    if (local && sync.dirtyChapters.includes(r.id)) {
      for (const f of PROGRESS) (next as unknown as Record<string, unknown>)[f] = local[f];
      // The server may have written the glossary meanwhile: keep it, plus this device's own lookups.
      next.glossary = { ...r.data.glossary, ...local.glossary };
    }
    series.chapters[r.idx] = next;
    changed = true;
  }
  for (const s of state.series) s.chapters = s.chapters.filter(Boolean);
  state.series.sort((a, b) => b.createdAt - a.createdAt);

  sync.lastSync = remote.now;
  return changed;
}

export interface Job {
  status: "queued" | "running" | "done" | "error";
  error: string | null;
  seriesId: string | null;
  chapterId: string | null;
}

/** Asks the server to write a chapter in the background and returns the job to watch. */
export async function requestChapter(series: Series | null, req: { genre: string; idea: string; fromSeriesId?: string } | null): Promise<string> {
  const res = series ? await api<{ jobId: string }>(`/api/series/${series.id}/next`, "POST") : await api<{ jobId: string }>("/api/series", "POST", req);
  return res.jobId;
}

export function jobStatus(jobId: string): Promise<Job> {
  return api<Job>(`/api/jobs/${jobId}`);
}
