// Taskututtor account-mode API (Cloudflare Worker).
//
// Signed-in readers get their library synced between devices and their chapters written in the
// background. The Worker verifies Clerk session tokens, stores JSON documents in D1, pictures in
// R2, and writes chapters from a queue so generation continues after the app is closed.

import { verifyToken } from "@clerk/backend";
import type { Chapter, Series } from "../../src/store";
import {
  applyChapter,
  applyGlossary,
  buildPrompt,
  GLOSSARY_SCHEMA,
  GLOSSARY_SYSTEM,
  glossaryPrompt,
  CHAPTER_SCHEMA,
  DICT_SCHEMA,
  dictQuestion,
  illustrationPrompt,
  LOOKUP_SCHEMA,
  lookupQuestion,
  parseDict,
  parseJson,
  parseLookup,
  SYSTEM,
  toChapter,
  type ChapterPayload,
  type PromptState,
} from "../../src/story";
import { runBackup } from "./backup";
import type { Env, QueueBatch } from "./bindings";
import { capture, captureGeneration } from "./telemetry";

/** What a reader's profile document holds. Everything else lives in series and chapters. */
interface Profile {
  level: number;
  lang: string;
  interests: string;
  yki: boolean;
  illustrations: boolean;
  words: PromptState["words"];
  [key: string]: unknown;
}

const DEFAULT_PROFILE: Profile = { level: 1, lang: "English", interests: "", yki: true, illustrations: false, words: {} };

/** Reader-owned fields of a chapter that the app may change; the rest is written by the server. */
const PROGRESS_FIELDS = ["lookedUp", "peeked", "answers", "finished", "feedback", "levelDelta", "glossary"] as const;

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const id = () => crypto.randomUUID().replace(/-/g, "").slice(0, 20);

// ---------- http plumbing ----------

function cors(env: Env, req: Request): Record<string, string> {
  const allowed = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());
  const origin = req.headers.get("Origin") ?? "";
  const allow = allowed.includes("*") ? "*" : allowed.includes(origin) ? origin : allowed[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

async function authenticate(req: Request, env: Env): Promise<string> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Sign in to continue.");
  if (env.DEV_AUTH === "1" && token.startsWith("dev:")) return token;
  if (!env.CLERK_JWT_KEY) throw new HttpError(500, "The server is missing its sign-in configuration.");
  try {
    const allowed = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());
    const payload = await verifyToken(token, {
      jwtKey: env.CLERK_JWT_KEY,
      authorizedParties: allowed.includes("*") ? undefined : allowed,
    });
    return payload.sub;
  } catch {
    throw new HttpError(401, "Your session has expired. Sign in again.");
  }
}

// ---------- storage ----------

async function loadProfile(env: Env, user: string): Promise<{ data: Profile; updatedAt: number }> {
  const row = await env.DB.prepare("SELECT data, updated_at FROM profiles WHERE user_id = ?").bind(user).first<{ data: string; updated_at: number }>();
  if (!row) return { data: { ...DEFAULT_PROFILE }, updatedAt: 0 };
  return { data: { ...DEFAULT_PROFILE, ...JSON.parse(row.data) }, updatedAt: row.updated_at };
}

/** The reader's whole library, with chapters attached to their series. */
async function loadLibrary(env: Env, user: string): Promise<Series[]> {
  const [series, chapters] = await Promise.all([
    env.DB.prepare("SELECT id, data FROM series WHERE user_id = ? AND deleted = 0 ORDER BY updated_at DESC").bind(user).all<{ id: string; data: string }>(),
    env.DB.prepare("SELECT series_id, data FROM chapters WHERE user_id = ? ORDER BY idx").bind(user).all<{ series_id: string; data: string }>(),
  ]);
  const byId = new Map<string, Series>();
  for (const row of series.results) byId.set(row.id, { ...(JSON.parse(row.data) as Series), id: row.id, chapters: [] });
  for (const row of chapters.results) byId.get(row.series_id)?.chapters.push(JSON.parse(row.data) as Chapter);
  return [...byId.values()];
}

function seriesMeta(s: Series): string {
  const { chapters: _chapters, ...meta } = s;
  return JSON.stringify(meta);
}

const imageKey = (user: string, chapterId: string) => `${user}/${chapterId}`;

// ---------- OpenRouter ----------

/** Who an AI call is for and what it does; used for cost tracking only. */
interface Purpose {
  user: string;
  kind: "story" | "glossary" | "illustration" | "lookup" | "dictionary";
}

async function openRouter(env: Env, path: string, body: Record<string, unknown>, purpose: Purpose): Promise<any> {
  const started = Date.now();
  const model = String(body.model);
  let status = 0;
  try {
    const res = await fetch(`${env.OPENROUTER_BASE ?? "https://openrouter.ai/api/v1"}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, "Content-Type": "application/json", "X-Title": "Taskututtor" },
      // Ask OpenRouter to report what the call cost.
      body: JSON.stringify(path === "/images" ? body : { ...body, usage: { include: true } }),
    });
    status = res.status;
    const json = (await res.json().catch(() => null)) as any;
    if (!res.ok || json?.error) throw new Error(`The AI service failed (${res.status})${json?.error?.message ? `: ${json.error.message}` : ""}`);
    captureGeneration(env, purpose.user, purpose.kind, model, started, { usage: json?.usage, status });
    return json;
  } catch (e) {
    captureGeneration(env, purpose.user, purpose.kind, model, started, { status, error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

async function askJson(env: Env, purpose: Purpose, model: string, name: string, schema: Record<string, unknown>, question: string, system?: string): Promise<string> {
  const json = await openRouter(
    env,
    "/chat/completions",
    {
      model,
      reasoning: { effort: "low" },
      response_format: { type: "json_schema", json_schema: { name, strict: true, schema } },
      messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: question }],
    },
    purpose,
  );
  return String(json?.choices?.[0]?.message?.content ?? "");
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Paints and stores the illustration of one chapter. Returns false when the model gave no picture. */
async function illustrate(env: Env, user: string, series: Series, ch: Chapter): Promise<boolean> {
  // An earlier picture of the series (or of the series it continues) anchors style and characters.
  let anchor = series.chapters.find((c) => c.id !== ch.id && c.hasImage);
  if (!anchor && series.basedOn) {
    const rows = await env.DB.prepare("SELECT data FROM chapters WHERE user_id = ? AND series_id = ? ORDER BY idx").bind(user, series.basedOn).all<{ data: string }>();
    anchor = rows.results.map((r) => JSON.parse(r.data) as Chapter).find((c) => c.hasImage);
  }
  let reference: string | undefined;
  if (anchor) {
    const obj = await env.IMAGES.get(imageKey(user, anchor.id));
    if (obj) reference = `data:${obj.httpMetadata?.contentType ?? "image/png"};base64,${toBase64(new Uint8Array(await obj.arrayBuffer()))}`;
  }
  const body: Record<string, unknown> = { model: env.IMAGE_MODEL, prompt: illustrationPrompt(series, ch, !!reference), aspect_ratio: "3:2", n: 1 };
  if (reference) body.input_references = [{ type: "image_url", image_url: { url: reference } }];
  const json = await openRouter(env, "/images", body, { user, kind: "illustration" });
  const item = json?.data?.[0];
  let bytes: Uint8Array | null = null;
  let type = "image/png";
  if (item?.b64_json) {
    bytes = Uint8Array.from(atob(item.b64_json), (c) => c.charCodeAt(0));
    type = item.media_type || type;
  } else if (item?.url) {
    const img = await fetch(item.url);
    if (img.ok) {
      bytes = new Uint8Array(await img.arrayBuffer());
      type = img.headers.get("Content-Type") ?? type;
    }
  }
  if (!bytes) return false;
  await env.IMAGES.put(imageKey(user, ch.id), bytes, { httpMetadata: { contentType: type } });
  return true;
}

// ---------- background chapter writing ----------

interface JobInput {
  seriesId?: string;
  genre?: string;
  idea?: string;
  fromSeriesId?: string;
}

interface Written {
  seriesId: string;
  chapterId: string;
  series: Series;
  chapter: Chapter;
  lang: string;
  illustrations: boolean;
}

/** Writes and saves the story of one chapter. Its glossary and picture follow in finishChapter. */
async function writeChapter(env: Env, user: string, input: JobInput): Promise<Written> {
  const [profile, library] = await Promise.all([loadProfile(env, user), loadLibrary(env, user)]);
  const state: PromptState = { settings: profile.data, words: profile.data.words ?? {}, series: library };

  const existing = input.seriesId ? library.find((s) => s.id === input.seriesId) : undefined;
  if (input.seriesId && !existing) throw new Error("That series no longer exists.");
  const req = existing ? null : { genre: input.genre || "Surprise me", idea: input.idea ?? "", from: library.find((s) => s.id === input.fromSeriesId) };

  const json = await openRouter(
    env,
    "/chat/completions",
    {
    model: env.STORY_MODEL,
    reasoning: { effort: "medium" },
    response_format: { type: "json_schema", json_schema: { name: "chapter", strict: true, schema: CHAPTER_SCHEMA } },
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: buildPrompt(state, existing ?? null, req) },
    ],
    },
    { user, kind: "story" },
  );
  const choice = json?.choices?.[0];
  if (choice?.finish_reason === "length") throw new Error("The chapter came out too long and was cut off. Please try again.");
  const payload = parseJson<ChapterPayload>(String(choice?.message?.content ?? ""));
  if (!payload || !Array.isArray(payload.paragraphs)) throw new Error("The story came back in an unexpected format. Please try again.");

  const chapter = toChapter(payload, profile.data.level);
  const series = applyChapter(existing ?? null, chapter, payload, req);
  const now = Date.now();
  const idx = series.chapters.length - 1;

  // Save the story straight away: the reader can start it while the glossary and picture are made.
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO series (id, user_id, data, deleted, updated_at) VALUES (?, ?, ?, 0, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
    ).bind(series.id, user, seriesMeta(series), now),
    env.DB.prepare("INSERT INTO chapters (id, series_id, user_id, idx, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(
      chapter.id,
      series.id,
      user,
      idx,
      JSON.stringify(chapter),
      now,
      now,
    ),
  ]);

  return { seriesId: series.id, chapterId: chapter.id, series, chapter, lang: profile.data.lang, illustrations: profile.data.illustrations };
}

/**
 * Writes a chapter's word glossary with the cheap glossary model and stores it. Only the glossary
 * fields are touched: the reader may already be reading the chapter on a device.
 */
async function writeGlossary(env: Env, user: string, chapter: Chapter, lang: string): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const answer = await askJson(env, { user, kind: "glossary" }, env.GLOSSARY_MODEL, "glossary", GLOSSARY_SCHEMA, glossaryPrompt(chapter, lang), GLOSSARY_SYSTEM);
      if (!applyGlossary(chapter, answer)) continue;
      await env.DB.prepare(
        "UPDATE chapters SET data = json_set(data, '$.glossary', json_patch(json(?), json_extract(data, '$.glossary')), '$.glossaryPending', json('false')), updated_at = ? WHERE id = ? AND user_id = ?",
      )
        .bind(JSON.stringify(chapter.glossary), Date.now(), chapter.id, user)
        .run();
      return true;
    } catch (e) {
      console.log("glossary failed", e instanceof Error ? e.message : e);
    }
  }
  capture(env, user, "chapter_generation_failed", { stage: "glossary" });
  return false;
}

/** After the story is saved: the glossary, then (if the reader wants pictures) the illustration. */
async function finishChapter(env: Env, user: string, made: Written): Promise<void> {
  await writeGlossary(env, user, made.chapter, made.lang);
  if (!made.illustrations) return;
  try {
    if (await illustrate(env, user, made.series, made.chapter)) {
      await env.DB.prepare("UPDATE chapters SET data = json_set(data, '$.hasImage', json('true')), updated_at = ? WHERE id = ? AND user_id = ?")
        .bind(Date.now(), made.chapter.id, user)
        .run();
    }
  } catch (e) {
    console.log("illustration failed", e instanceof Error ? e.message : e);
    capture(env, user, "chapter_generation_failed", { stage: "illustration", error: (e instanceof Error ? e.message : String(e)).slice(0, 200) });
  }
}

async function runJob(env: Env, jobId: string): Promise<void> {
  const job = await env.DB.prepare("SELECT user_id, input, status FROM jobs WHERE id = ?").bind(jobId).first<{ user_id: string; input: string; status: string }>();
  if (!job || job.status !== "queued") return;
  const set = (status: string, extra: Record<string, string | null> = {}) =>
    env.DB.prepare("UPDATE jobs SET status = ?, error = ?, series_id = ?, chapter_id = ?, updated_at = ? WHERE id = ?")
      .bind(status, extra.error ?? null, extra.seriesId ?? null, extra.chapterId ?? null, Date.now(), jobId)
      .run();
  await set("running");
  const started = Date.now();
  try {
    const made = await writeChapter(env, job.user_id, JSON.parse(job.input) as JobInput);
    // The job is done as soon as the story can be read; the rest arrives through sync.
    await set("done", { seriesId: made.seriesId, chapterId: made.chapterId });
    capture(env, job.user_id, "chapter_generated", {
      seconds: Math.round((Date.now() - started) / 1000),
      chapter_number: made.series.chapters.length,
      level: made.chapter.level,
      illustrated: made.illustrations,
    });
    await finishChapter(env, job.user_id, made);
  } catch (e) {
    const error = e instanceof Error ? e.message : "Something went wrong while writing the chapter.";
    await set("error", { error });
    capture(env, job.user_id, "chapter_generation_failed", { stage: "story", error: error.slice(0, 200), seconds: Math.round((Date.now() - started) / 1000) });
  }
}

async function enqueue(env: Env, user: string, input: JobInput): Promise<Response> {
  const dayStart = new Date().setUTCHours(0, 0, 0, 0);
  const limit = Number(env.DAILY_CHAPTER_LIMIT) || 5;
  const [written, pending] = await Promise.all([
    // Counted from finished jobs, not chapters, so deleting a series does not hand the quota back.
    env.DB.prepare("SELECT COUNT(*) AS n FROM jobs WHERE user_id = ? AND status = 'done' AND created_at >= ?").bind(user, dayStart).first<{ n: number }>(),
    env.DB.prepare("SELECT id FROM jobs WHERE user_id = ? AND status IN ('queued', 'running') AND created_at >= ?")
      .bind(user, Date.now() - 20 * 60_000)
      .first<{ id: string }>(),
  ]);
  // One chapter at a time: asking again while one is being written returns the same job.
  if (pending) return Response.json({ jobId: pending.id });
  if ((written?.n ?? 0) >= limit) capture(env, user, "daily_limit_reached", { limit });
  if ((written?.n ?? 0) >= limit) throw new HttpError(429, `You've reached today's limit of ${limit} new chapters. More tomorrow!`);

  const jobId = id();
  const now = Date.now();
  await env.DB.prepare("INSERT INTO jobs (id, user_id, input, status, created_at, updated_at) VALUES (?, ?, ?, 'queued', ?, ?)")
    .bind(jobId, user, JSON.stringify(input), now, now)
    .run();
  await env.JOBS.send({ jobId });
  return Response.json({ jobId });
}

// ---------- routes ----------

async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");
  const m = (method: string, pattern: RegExp) => (req.method === method ? path.match(pattern) : null);
  if (path === "/api/health") return Response.json({ ok: true });

  const user = await authenticate(req, env);
  const body = async <T>() => ((await req.json().catch(() => ({}))) ?? {}) as T;
  let hit: RegExpMatchArray | null;

  // Everything that changed since the app last synced.
  if (m("GET", /^\/api\/state$/)) {
    const since = Number(url.searchParams.get("since")) || 0;
    const now = Date.now();
    const [profile, series, chapters] = await Promise.all([
      loadProfile(env, user),
      env.DB.prepare("SELECT id, data, deleted, updated_at FROM series WHERE user_id = ? AND updated_at > ?").bind(user, since).all<any>(),
      env.DB.prepare("SELECT id, series_id, idx, data, updated_at FROM chapters WHERE user_id = ? AND updated_at > ? ORDER BY idx").bind(user, since).all<any>(),
    ]);
    return Response.json({
      now,
      profile: profile.updatedAt > since ? profile : null,
      series: series.results.map((r) => ({ id: r.id, deleted: !!r.deleted, updatedAt: r.updated_at, data: JSON.parse(r.data) })),
      chapters: chapters.results.map((r) => ({ id: r.id, seriesId: r.series_id, idx: r.idx, updatedAt: r.updated_at, data: JSON.parse(r.data) })),
    });
  }

  if (m("PUT", /^\/api\/profile$/)) {
    const data = await body<Profile>();
    const now = Date.now();
    await env.DB.prepare("INSERT INTO profiles (user_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at")
      .bind(user, JSON.stringify(data), now)
      .run();
    return Response.json({ updatedAt: now });
  }

  // Reading progress of one chapter (looked-up words, answers, feedback…).
  if ((hit = m("PUT", /^\/api\/chapters\/([\w-]+)$/))) {
    const row = await env.DB.prepare("SELECT data FROM chapters WHERE id = ? AND user_id = ?").bind(hit[1], user).first<{ data: string }>();
    if (!row) throw new HttpError(404, "Chapter not found.");
    const chapter = JSON.parse(row.data) as Record<string, unknown>;
    const patch = await body<Record<string, unknown>>();
    for (const f of PROGRESS_FIELDS) if (f in patch && f !== "glossary") chapter[f] = patch[f];
    // Glossary entries are only ever added from the app (single-word lookups), never removed:
    // a device that has not received the server-written glossary yet must not wipe it.
    if (patch.glossary && typeof patch.glossary === "object") chapter.glossary = { ...(chapter.glossary as object), ...(patch.glossary as object) };
    const now = Date.now();
    await env.DB.prepare("UPDATE chapters SET data = ?, updated_at = ? WHERE id = ? AND user_id = ?").bind(JSON.stringify(chapter), now, hit[1], user).run();
    return Response.json({ updatedAt: now });
  }

  if (m("POST", /^\/api\/series$/)) {
    const b = await body<JobInput>();
    return enqueue(env, user, { genre: String(b.genre ?? ""), idea: String(b.idea ?? "").slice(0, 600), fromSeriesId: b.fromSeriesId });
  }

  if ((hit = m("POST", /^\/api\/series\/([\w-]+)\/next$/))) return enqueue(env, user, { seriesId: hit[1] });

  if ((hit = m("DELETE", /^\/api\/series\/([\w-]+)$/))) {
    const chapters = await env.DB.prepare("SELECT id FROM chapters WHERE series_id = ? AND user_id = ?").bind(hit[1], user).all<{ id: string }>();
    if (chapters.results.length) await env.IMAGES.delete(chapters.results.map((c) => imageKey(user, c.id)));
    await env.DB.batch([
      env.DB.prepare("DELETE FROM chapters WHERE series_id = ? AND user_id = ?").bind(hit[1], user),
      env.DB.prepare("UPDATE series SET deleted = 1, data = '{}', updated_at = ? WHERE id = ? AND user_id = ?").bind(Date.now(), hit[1], user),
    ]);
    return Response.json({ ok: true });
  }

  if ((hit = m("GET", /^\/api\/jobs\/([\w-]+)$/))) {
    const job = await env.DB.prepare("SELECT status, error, series_id, chapter_id FROM jobs WHERE id = ? AND user_id = ?").bind(hit[1], user).first<any>();
    if (!job) throw new HttpError(404, "Job not found.");
    return Response.json({ status: job.status, error: job.error, seriesId: job.series_id, chapterId: job.chapter_id });
  }

  if ((hit = m("GET", /^\/api\/images\/([\w-]+)$/))) {
    const obj = await env.IMAGES.get(imageKey(user, hit[1]));
    if (!obj) throw new HttpError(404, "No illustration for this chapter.");
    return new Response(obj.body, { headers: { "Content-Type": obj.httpMetadata?.contentType ?? "image/png", "Cache-Control": "private, max-age=3600" } });
  }

  // Paint (or repaint) one chapter's illustration.
  if ((hit = m("POST", /^\/api\/chapters\/([\w-]+)\/illustrate$/))) {
    const library = await loadLibrary(env, user);
    const series = library.find((s) => s.chapters.some((c) => c.id === hit![1]));
    const chapter = series?.chapters.find((c) => c.id === hit![1]);
    if (!series || !chapter) throw new HttpError(404, "Chapter not found.");
    if (!(await illustrate(env, user, series, chapter))) throw new HttpError(502, "The image model returned no picture. Try again.");
    await env.DB.prepare("UPDATE chapters SET data = json_set(data, '$.hasImage', json('true')), updated_at = ? WHERE id = ? AND user_id = ?").bind(Date.now(), chapter.id, user).run();
    return Response.json({ ok: true });
  }

  // Writes a chapter's glossary if it is still missing (the background attempt failed).
  if ((hit = m("POST", /^\/api\/chapters\/([\w-]+)\/glossary$/))) {
    const row = await env.DB.prepare("SELECT data FROM chapters WHERE id = ? AND user_id = ?").bind(hit[1], user).first<{ data: string }>();
    if (!row) throw new HttpError(404, "Chapter not found.");
    const chapter = JSON.parse(row.data) as Chapter;
    if (chapter.glossaryPending) {
      const profile = await loadProfile(env, user);
      if (!(await writeGlossary(env, user, chapter, profile.data.lang))) throw new HttpError(502, "The word meanings could not be prepared. Try again in a moment.");
    }
    return Response.json({ ok: true });
  }

  if (m("POST", /^\/api\/lookup$/)) {
    const b = await body<{ word?: string; sentence?: string }>();
    const word = String(b.word ?? "").slice(0, 80);
    if (!word) throw new HttpError(400, "No word given.");
    const profile = await loadProfile(env, user);
    const text = await askJson(env, { user, kind: "lookup" }, env.LOOKUP_MODEL, "word", LOOKUP_SCHEMA, lookupQuestion(profile.data.lang, word, String(b.sentence ?? "").slice(0, 500)));
    return Response.json(parseLookup(text, word));
  }

  if (m("POST", /^\/api\/dict$/)) {
    const lemma = String((await body<{ lemma?: string }>()).lemma ?? "").slice(0, 80);
    if (!lemma) throw new HttpError(400, "No word given.");
    const profile = await loadProfile(env, user);
    return Response.json(parseDict(await askJson(env, { user, kind: "dictionary" }, env.LOOKUP_MODEL, "entry", DICT_SCHEMA, dictQuestion(profile.data.lang, lemma)), lemma));
  }

  throw new HttpError(404, "Not found.");
}

export default {
  async fetch(req: Request, bindings: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<Response> {
    const env: Env = { ...bindings, wait: (p) => ctx.waitUntil(p) };
    const headers = cors(env, req);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
    let res: Response;
    try {
      res = await route(req, env);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) {
        console.log("request failed", e instanceof Error ? e.stack : e);
        capture(env, "server", "server_error", { path: new URL(req.url).pathname.replace(/[\w-]{12,}/g, ":id"), error: (e instanceof Error ? e.message : String(e)).slice(0, 200) });
      }
      res = Response.json({ error: e instanceof Error && status !== 500 ? e.message : e instanceof Error ? e.message : "Server error" }, { status });
    }
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
    return out;
  },

  /** Cron trigger (see wrangler.toml): the weekly database export. */
  async scheduled(_event: unknown, env: Env): Promise<void> {
    const done = await runBackup(env);
    console.log(`backup written: ${done.key} (${done.rows} rows, ${done.bytes} bytes)`);
  },

  async queue(batch: QueueBatch, bindings: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<void> {
    const env: Env = { ...bindings, wait: (p) => ctx.waitUntil(p) };
    for (const msg of batch.messages) {
      await runJob(env, msg.body.jobId);
      msg.ack();
    }
  },
};
