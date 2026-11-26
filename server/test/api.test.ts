// End-to-end test of the API: a real local Worker (wrangler dev with local D1, R2 and Queues)
// talking to a fake OpenRouter, driven over HTTP the way the app drives it.

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8791;
const API = `http://127.0.0.1:${PORT}/api`;
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAFElEQVR4nGP8z8DAwMDAxAADKCwAGQYBAxCuM5cAAAAASUVORK5CYII=";

let mock: Server;
let worker: ChildProcess;
let persist: string;
/** What the fake AI service was asked, in order. */
const asked: { kind: string; prompt?: string; reference?: boolean }[] = [];
/** Analytics events the Worker sent to the fake PostHog. */
const events: { event: string; distinct_id: string; properties: Record<string, any> }[] = [];

function startMock(): Promise<number> {
  let n = 0;
  mock = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      res.setHeader("content-type", "application/json");
      if (req.url!.startsWith("/i/v0/e")) {
        events.push(body);
        return res.end("{}");
      }
      if (req.url!.endsWith("/images")) {
        asked.push({ kind: "image", reference: !!body.input_references });
        return res.end(JSON.stringify({ data: [{ b64_json: PNG, media_type: "image/png" }] }));
      }
      const name = body.response_format?.json_schema?.name;
      let content: unknown;
      if (name === "word") content = { lemma: "kirje", tr: "letter", note: "accusative", name: false };
      else if (name === "glossary") {
        // One entry per word form the Worker listed, like a real glossary model.
        const forms: string[] = body.messages[1].content.split(/WORD FORMS \(\d+\)\n/)[1].split("\n");
        asked.push({ kind: "glossary", prompt: body.model });
        content = { glossary: forms.map((form) => ({ form, lemma: form, tr: `tr:${form}`, note: "", name: form === "liisa" })) };
      } else if (name === "entry") content = { entries: [{ pos: "noun", senses: [{ def: "letter", examples: [] }] }] };
      else {
        n++;
        const prompt: string = body.messages[1].content;
        asked.push({ kind: "chapter", prompt });
        content = {
          series_title: "Majakka",
          series_premise: "A lighthouse.",
          chapter_title: `Luku ${n}`,
          chapter_title_tr: `Chapter ${n}`,
          paragraphs: [[{ fi: "Liisa löytää kirjeen.", tr: "Liisa finds a letter." }]],
          story_so_far: `Canon ${n}`,
          art_bible: "Gouache.",
          illustration_scene: "scene",
          chapter_recap: `Recap ${n}`,
          plan: prompt.includes("existing plan") ? { truth: "", ending: "", beats: [] } : { truth: "T", ending: "E", beats: ["A", "B", "C"] },
          questions: [],
        };
      }
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: "stop" }], usage: { prompt_tokens: 1200, completion_tokens: 800, cost: 0.0123 } }));
    });
  });
  return new Promise((resolve) => mock.listen(0, "127.0.0.1", () => resolve((mock.address() as AddressInfo).port)));
}

const call = async (user: string | null, method: string, path: string, body?: unknown) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(user ? { Authorization: `Bearer dev:${user}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: res.headers.get("content-type")?.includes("json") ? ((await res.json()) as any) : null, res };
};

async function finished(user: string, jobId: string) {
  for (let i = 0; i < 100; i++) {
    const { json } = await call(user, "GET", `/jobs/${jobId}`);
    if (json.status === "done" || json.status === "error") return json;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("job did not finish");
}

/** Waits until a chapter's glossary (and picture, if wanted) has arrived after its story. */
async function settled(user: string, chapterId: string, picture = true) {
  for (let i = 0; i < 100; i++) {
    const ch = (await call(user, "GET", "/state")).json.chapters.find((c: any) => c.id === chapterId)?.data;
    if (ch && !ch.glossaryPending && (!picture || ch.hasImage)) return ch;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("chapter did not settle");
}

const write = async (user: string, path: string, body?: unknown) => {
  const job = await finished(user, (await call(user, "POST", path, body)).json.jobId);
  if (job.status === "done") await settled(user, job.chapterId);
  return job;
};

beforeAll(async () => {
  const mockPort = await startMock();
  persist = mkdtempSync(join(tmpdir(), "taskututtor-test-"));
  // wrangler refuses to start without the web app's folder; the API test doesn't need its content.
  if (!existsSync(join(root, "web"))) {
    mkdirSync(join(root, "web"));
    writeFileSync(join(root, "web", "index.html"), "<!doctype html><title>test</title>");
  }
  const wrangler = join(root, "node_modules", ".bin", "wrangler");
  execFileSync(wrangler, ["d1", "execute", "taskututtor", "--local", "--persist-to", persist, "--file", "schema.sql"], { cwd: root, stdio: "pipe" });
  worker = spawn(
    wrangler,
    ["dev", "--local", "--port", String(PORT), "--persist-to", persist, "--test-scheduled", "--var", "DEV_AUTH:1", "--var", "OPENROUTER_API_KEY:test", "--var", `OPENROUTER_BASE:http://127.0.0.1:${mockPort}`, "--var", "DAILY_CHAPTER_LIMIT:3", "--var", "POSTHOG_KEY:phc_test", "--var", `POSTHOG_HOST:http://127.0.0.1:${mockPort}`],
    { cwd: root, stdio: "pipe", detached: true },
  );
  for (let i = 0; i < 300; i++) {
    if (await fetch(`${API}/health`).then((r) => r.ok, () => false)) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("the local Worker did not start");
});

afterAll(() => {
  try {
    process.kill(-worker.pid!, "SIGKILL"); // wrangler and the runtime it started
  } catch {
    /* already gone */
  }
  mock?.close();
  rmSync(persist, { recursive: true, force: true });
});

describe("account API", () => {
  let seriesId: string;
  let chapterId: string;

  it("rejects calls without a sign-in", async () => {
    expect((await call(null, "GET", "/state")).status).toBe(401);
  });

  it("stores a reader's profile", async () => {
    const profile = { level: 2.25, lang: "English", interests: "scifi", yki: true, illustrations: true, words: {} };
    expect((await call("alice", "PUT", "/profile", profile)).status).toBe(200);
    expect((await call("alice", "GET", "/state")).json.profile.data).toMatchObject({ level: 2.25, illustrations: true });
  });

  it("writes chapter 1 of a new series in the background, with its picture", async () => {
    const job = await write("alice", "/series", { genre: "Mystery", idea: "a lighthouse" });
    expect(job).toMatchObject({ status: "done", error: null });
    ({ seriesId, chapterId } = job);

    const { json } = await call("alice", "GET", "/state");
    expect(json.series).toHaveLength(1);
    expect(json.series[0].data).toMatchObject({ title: "Majakka", plan: { beats: ["A", "B", "C"], start: 0 } });
    expect(json.chapters[0]).toMatchObject({ id: chapterId, idx: 0, data: { title: "Luku 1", hasImage: true, level: 2.25 } });

    const image = await call("alice", "GET", `/images/${chapterId}`);
    expect(image.status).toBe(200);
    expect(image.res.headers.get("content-type")).toBe("image/png");
    // The reader's level reached the writer, and the first picture had nothing to match.
    expect(asked[0].prompt).toContain("Reader's level: 2.25");
    // The glossary came from the cheap glossary model, after the story, and covers every word.
    expect(asked[1]).toMatchObject({ kind: "glossary", prompt: "openai/gpt-6-luna" });
    expect(Object.keys(json.chapters[0].data.glossary).sort()).toEqual(["kirjeen", "liisa", "löytää"]);
    expect(json.chapters[0].data.glossaryPending).toBe(false);
    expect(asked[2]).toMatchObject({ kind: "image", reference: false });
  });

  it("saves reading progress but never lets the app rewrite the story", async () => {
    // A device that has not received the glossary yet sends an empty one, plus one word it looked up itself.
    await call("alice", "PUT", `/chapters/${chapterId}`, { finished: true, feedback: "hard", lookedUp: ["kirje"], title: "HACKED", glossary: { uusi: { lemma: "uusi", tr: "new", note: "" } }, glossaryPending: true });
    const ch = (await call("alice", "GET", "/state")).json.chapters[0].data;
    expect(ch).toMatchObject({ finished: true, feedback: "hard", lookedUp: ["kirje"], title: "Luku 1", glossaryPending: false });
    expect(Object.keys(ch.glossary).sort()).toEqual(["kirjeen", "liisa", "löytää", "uusi"]);
  });

  it("continues a series along its plan, using the reader's feedback and an earlier picture", async () => {
    const job = await write("alice", `/series/${seriesId}/next`);
    expect(job.status).toBe("done");
    const prompt = asked.filter((a) => a.kind === "chapter")[1].prompt!;
    expect(prompt).toContain("2. B  ← WRITE THIS NOW");
    expect(prompt).toContain("too hard");
    expect(asked.at(-1)).toMatchObject({ kind: "image", reference: true });
    expect((await call("alice", "GET", "/state")).json.chapters.map((c: any) => c.idx)).toEqual([0, 1]);
  });

  it("returns only what changed since the last sync", async () => {
    const { now } = (await call("alice", "GET", "/state")).json;
    const delta = (await call("alice", "GET", `/state?since=${now}`)).json;
    expect(delta).toMatchObject({ profile: null, series: [], chapters: [] });
  });

  it("keeps readers' libraries and pictures apart", async () => {
    const other = (await call("bob", "GET", "/state")).json;
    expect(other.series).toEqual([]);
    expect(other.chapters).toEqual([]);
    expect((await call("bob", "GET", `/images/${chapterId}`)).status).toBe(404);
    expect((await call("bob", "PUT", `/chapters/${chapterId}`, { finished: false })).status).toBe(404);
    expect((await call("bob", "DELETE", `/series/${seriesId}`)).status).toBe(200);
    expect((await call("alice", "GET", "/state")).json.chapters).toHaveLength(2);
  });

  it("answers word lookups and dictionary requests", async () => {
    expect((await call("alice", "POST", "/lookup", { word: "kirjeen", sentence: "Liisa löytää kirjeen." })).json).toEqual({ lemma: "kirje", tr: "letter", note: "accusative" });
    expect((await call("alice", "POST", "/dict", { lemma: "kirje" })).json).toMatchObject({ lemma: "kirje", source: "ai" });
    expect((await call("alice", "POST", "/lookup", {})).status).toBe(400);
  });

  it("enforces the daily chapter limit, even after deleting a series", async () => {
    expect((await write("alice", `/series/${seriesId}/next`)).status).toBe("done"); // third chapter today
    expect((await call("alice", "DELETE", `/series/${seriesId}`)).status).toBe(200);
    const refused = await call("alice", "POST", "/series", { genre: "Mystery" });
    expect(refused.status).toBe(429);
    expect(refused.json.error).toContain("limit of 3");
  });

  it("deletes a series with its chapters and pictures", async () => {
    const { json } = await call("alice", "GET", "/state");
    expect(json.series).toMatchObject([{ id: seriesId, deleted: true }]);
    expect(json.chapters).toEqual([]);
    expect((await call("alice", "GET", `/images/${chapterId}`)).status).toBe(404);
  });

  it("lets the reader start a chapter before its glossary exists", async () => {
    await call("dora", "PUT", "/profile", { level: 1, lang: "English", interests: "", yki: false, illustrations: false, words: {} });
    const job = await finished("dora", (await call("dora", "POST", "/series", { genre: "Mystery" })).json.jobId);
    expect(job.status).toBe("done");
    // The job reports done as soon as the story is saved; the chapter is readable at that moment.
    const early = (await call("dora", "GET", "/state")).json.chapters.find((c: any) => c.id === job.chapterId).data;
    expect(early.paragraphs[0][0].fi).toBe("Liisa löytää kirjeen.");
    const later = await settled("dora", job.chapterId, false);
    expect(Object.keys(later.glossary)).toHaveLength(3);
    // Asking for a glossary that already exists does nothing.
    expect((await call("dora", "POST", `/chapters/${job.chapterId}/glossary`)).status).toBe(200);
  });

  it("reports a failed chapter instead of losing the request", async () => {
    await call("carol", "PUT", "/profile", { level: 1, lang: "English", interests: "", yki: false, illustrations: false, words: {} });
    const job = await write("carol", "/series/does-not-exist/next");
    expect(job).toMatchObject({ status: "error", error: "That series no longer exists." });
  });

  it("stores a reader's problem report and tells analytics only its category", async () => {
    const sent = await call("alice", "POST", "/reports", { category: "content", message: "This chapter upset me because of PRIVATE-DETAIL.", chapterId: "abc123", screen: "reader" });
    expect(sent.status).toBe(200);
    expect((await call("alice", "POST", "/reports", { category: "nonsense" })).status).toBe(200); // unknown kinds are filed as "other"
    expect((await call(null, "POST", "/reports", { category: "bug" })).status).toBe(401);
    await new Promise((r) => setTimeout(r, 300));
    const reported = events.filter((e) => e.event === "problem_reported").map((e) => e.properties);
    expect(reported).toMatchObject([
      { category: "content", with_message: true, about_chapter: true },
      { category: "other", with_message: false, about_chapter: false },
    ]);
    expect(JSON.stringify(events)).not.toContain("PRIVATE-DETAIL");
  });

  it("reports usage, AI cost and failures to analytics, without any story content", async () => {
    await new Promise((r) => setTimeout(r, 500)); // background sends
    const of = (user: string, event: string) => events.filter((e) => e.distinct_id === `dev:${user}` && e.event === event);

    const calls = of("alice", "$ai_generation");
    expect(new Set(calls.map((e) => e.properties.kind))).toEqual(new Set(["story", "glossary", "illustration", "lookup", "dictionary"]));
    const story = calls.find((e) => e.properties.kind === "story")!;
    expect(story.properties).toMatchObject({ $ai_model: "openai/gpt-6.1-terra", $ai_provider: "openrouter", $ai_total_cost_usd: 0.0123, $ai_input_tokens: 1200, $ai_output_tokens: 800, $ai_is_error: false });

    expect(of("alice", "chapter_generated")).toHaveLength(3);
    expect(of("alice", "chapter_generated")[0].properties).toMatchObject({ chapter_number: 1, level: 2.25, illustrated: true });
    expect(of("alice", "daily_limit_reached")).toHaveLength(1);
    expect(of("carol", "chapter_generation_failed")[0].properties).toMatchObject({ stage: "story", error: "That series no longer exists." });

    expect(events.every((e) => (e as any).api_key === "phc_test")).toBe(true);
    const sent = JSON.stringify(events);
    for (const secret of ["Liisa", "kirjeen", "letter", "lighthouse", "Majakka"]) expect(sent).not.toContain(secret);
  });

  it("runs the scheduled database export", async () => {
    // wrangler's test hook for cron triggers (the real trigger is not an HTTP request)
    const res = await fetch(`http://127.0.0.1:${PORT}/cdn-cgi/handler/scheduled?cron=17+3+*+*+1`);
    expect(res.status).toBe(200);
  });
});
