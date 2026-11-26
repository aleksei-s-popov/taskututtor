// Story generation and on-demand lookups, called straight from the browser with the reader's own
// API key: through OpenRouter (default, any model) or the Anthropic API directly.

import Anthropic from "@anthropic-ai/sdk";
import type { DictCard } from "./dict";
import { formKey, tokenize, type Chapter, type GlossEntry, type Series, type State } from "./store";
import {
  applyGlossary,
  buildPrompt,
  CHAPTER_SCHEMA,
  GLOSSARY_SCHEMA,
  GLOSSARY_SYSTEM,
  glossaryPrompt,
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
  type NewSeriesRequest,
} from "./story";

export type { NewSeriesRequest };

/** With an Anthropic key, glossaries are written by the small, cheap model. */
const ANTHROPIC_GLOSSARY_MODEL = "claude-haiku-5-5";

const FALLBACK_BETA = "server-side-fallback-2026-07-01";

function client(state: State): Anthropic {
  return new Anthropic({ apiKey: state.settings.apiKey, dangerouslyAllowBrowser: true });
}

export function friendlyError(e: unknown): string {
  if (e instanceof DOMException && e.name === "AbortError") return "Cancelled.";
  if (e instanceof Anthropic.AuthenticationError) return "Your API key was rejected. Check it in Settings.";
  if (e instanceof Anthropic.PermissionDeniedError) return "This API key isn't allowed to use the selected model.";
  if (e instanceof Anthropic.RateLimitError) return "Rate limit reached — wait a moment and try again.";
  if (e instanceof Anthropic.APIUserAbortError) return "Cancelled.";
  if (e instanceof Anthropic.APIConnectionError) return "Couldn't reach the Claude API. Check your connection.";
  if (e instanceof Anthropic.APIError) {
    if (e.status === 529 || (e.status ?? 0) >= 500) return "Claude is overloaded right now — try again shortly.";
    return `Claude API error: ${e.message}`;
  }
  return e instanceof Error ? e.message : String(e);
}

export interface Generation {
  promise: Promise<{ chapter: Chapter; payload: ChapterPayload }>;
  cancel: () => void;
}

/** Writes the next chapter of `series`, or chapter 1 of a new series when `series` is null. */
export function generateChapter(
  state: State,
  series: Series | null,
  req: NewSeriesRequest | null,
  onProgress: (chars: number) => void,
): Generation {
  const level = state.settings.level;
  const prompt = buildPrompt(state, series, req);
  const run = state.settings.provider === "openrouter" ? openRouterText(state, prompt, onProgress) : anthropicText(state, prompt, onProgress);
  const promise = run.promise.then((text) => {
    const payload = parseJson<ChapterPayload>(text);
    if (!payload || !Array.isArray(payload.paragraphs))
      throw new Error("The story came back in an unexpected format. Please try again.");
    return { chapter: toChapter(payload, level), payload };
  });
  return { promise, cancel: run.cancel };
}

interface TextRun {
  promise: Promise<string>;
  cancel: () => void;
}

function anthropicText(state: State, prompt: string, onProgress: (chars: number) => void): TextRun {
  const stream = client(state).beta.messages.stream({
    model: state.settings.model,
    max_tokens: 64000,
    // If the model declines a request, let the API retry it on its default fallback model.
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    system: SYSTEM,
    output_config: { effort: "medium", format: { type: "json_schema", schema: CHAPTER_SCHEMA } },
    messages: [{ role: "user", content: prompt }],
  });

  let chars = 0;
  stream.on("text", (delta) => {
    chars += delta.length;
    onProgress(chars);
  });

  const promise = stream.finalMessage().then((msg) => {
    if (msg.stop_reason === "refusal") throw new Error("Claude declined to write this one. Try a different idea.");
    if (msg.stop_reason === "max_tokens") throw new Error("The chapter came out too long and was cut off. Please try again.");
    return msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  });

  return { promise, cancel: () => stream.abort() };
}

// ---------- OpenRouter (OpenAI-compatible chat completions) ----------

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

async function openRouterRequest(
  state: State,
  body: Record<string, unknown>,
  signal?: AbortSignal,
  url = OPENROUTER_URL,
  model = state.settings.orModel,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      signal,
      headers: { Authorization: `Bearer ${state.settings.orKey}`, "Content-Type": "application/json", "X-Title": "Taskututtor" },
      body: JSON.stringify({ model, ...body }),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new Error("Couldn't reach OpenRouter. Check your connection.");
  }
  if (res.ok) return res;
  const detail = await res
    .json()
    .then((j) => String(j?.error?.message ?? ""))
    .catch(() => "");
  if (res.status === 401) throw new Error(`OpenRouter rejected the key${detail ? ` ("${detail}")` : ""}. Check it in Settings.`);
  if (res.status === 402) throw new Error("Your OpenRouter account is out of credits.");
  if (res.status === 429) throw new Error("Rate limit reached — wait a moment and try again.");
  if (res.status === 404 || res.status === 400) throw new Error(`OpenRouter couldn't run "${model}": ${detail || "check the model name in Settings."}`);
  throw new Error(`OpenRouter error ${res.status}${detail ? ": " + detail : ""}`);
}

function openRouterText(state: State, prompt: string, onProgress: (chars: number) => void): TextRun {
  const ctrl = new AbortController();
  const promise = (async () => {
    const res = await openRouterRequest(
      state,
      {
        stream: true,
        reasoning: { effort: "medium" },
        response_format: { type: "json_schema", json_schema: { name: "chapter", strict: true, schema: CHAPTER_SCHEMA } },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: prompt },
        ],
      },
      ctrl.signal,
    );
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let text = "";
    let finish = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue; // blank lines and ": keep-alive" comments
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        let chunk: { error?: { message?: string }; choices?: { delta?: { content?: string }; finish_reason?: string | null }[] };
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }
        if (chunk.error) throw new Error(`OpenRouter: ${chunk.error.message ?? "the model failed mid-story."}`);
        const choice = chunk.choices?.[0];
        if (choice?.delta?.content) {
          text += choice.delta.content;
          onProgress(text.length);
        }
        if (choice?.finish_reason) finish = choice.finish_reason;
      }
    }
    if (finish === "length") throw new Error("The chapter came out too long and was cut off. Please try again.");
    if (finish === "content_filter") throw new Error("The model declined to write this one. Try a different idea.");
    return text;
  })();
  return { promise, cancel: () => ctrl.abort() };
}

/** Fallback for a word that is missing from a chapter's glossary. */
export async function lookupWord(state: State, word: string, sentence: string): Promise<GlossEntry> {
  const question = lookupQuestion(state.settings.lang, word, sentence);
  let text: string;
  if (state.settings.provider === "openrouter") {
    const res = await openRouterRequest(state, {
      reasoning: { effort: "low" },
      response_format: { type: "json_schema", json_schema: { name: "word", strict: true, schema: LOOKUP_SCHEMA } },
      messages: [{ role: "user", content: question }],
    });
    const json = await res.json().catch(() => null);
    text = String(json?.choices?.[0]?.message?.content ?? "");
  } else {
    text = await anthropicLookup(state, question, LOOKUP_SCHEMA);
  }
  return parseLookup(text, word);
}

async function anthropicLookup(state: State, question: string, schema: Record<string, unknown>): Promise<string> {
  const msg = await client(state).messages.create({
    model: state.settings.model,
    max_tokens: 16000,
    output_config: { effort: "low", format: { type: "json_schema", schema } },
    messages: [
      {
        role: "user",
        content: question,
      },
    ],
  });
  if (msg.stop_reason === "refusal") throw new Error("Couldn't look that word up.");
  return msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
}

/**
 * Writes the word glossary of a chapter with the cheaper glossary model and stores it on the
 * chapter. Runs after the story is already on screen.
 */
export async function generateGlossary(state: State, ch: Chapter): Promise<void> {
  const prompt = glossaryPrompt(ch, state.settings.lang);
  let text: string;
  if (state.settings.provider === "openrouter") {
    const res = await openRouterRequest(
      state,
      {
        reasoning: { effort: "low" },
        response_format: { type: "json_schema", json_schema: { name: "glossary", strict: true, schema: GLOSSARY_SCHEMA } },
        messages: [
          { role: "system", content: GLOSSARY_SYSTEM },
          { role: "user", content: prompt },
        ],
      },
      undefined,
      OPENROUTER_URL,
      state.settings.orGlossModel || state.settings.orModel,
    );
    const json = await res.json().catch(() => null);
    text = String(json?.choices?.[0]?.message?.content ?? "");
  } else {
    // Long chapters have long glossaries: stream so the request cannot time out.
    const msg = await client(state)
      .messages.stream({
        model: ANTHROPIC_GLOSSARY_MODEL,
        max_tokens: 64000,
        system: GLOSSARY_SYSTEM,
        output_config: { effort: "low", format: { type: "json_schema", schema: GLOSSARY_SCHEMA } },
        messages: [{ role: "user", content: prompt }],
      })
      .finalMessage();
    text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  }
  if (!applyGlossary(ch, text)) throw new Error("The word meanings could not be prepared. They will be tried again.");
}

/** Share of the chapter's word tokens that have a glossary entry (sanity check for the UI). */
export function glossaryCoverage(ch: Chapter): number {
  let total = 0;
  let hit = 0;
  for (const p of ch.paragraphs)
    for (const s of p)
      for (const t of tokenize(s.fi))
        if (t.word) {
          total++;
          if (ch.glossary[formKey(t.text)]) hit++;
        }
  return total ? hit / total : 1;
}

// ---------- illustrations (OpenRouter Image API) ----------

const OPENROUTER_IMAGES_URL = "https://openrouter.ai/api/v1/images";

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("The illustration could not be read."));
    r.readAsDataURL(blob);
  });
}

/**
 * Paints one illustration for a chapter and returns it as a data URL.
 * Consistency across a series comes from two things: the series' art bible (fixed style and
 * character looks) in every prompt, and `reference` — an earlier illustration of the same series
 * that the image model is asked to match.
 */
export async function generateIllustration(state: State, series: Series, ch: Chapter, reference?: string): Promise<string> {
  const prompt = illustrationPrompt(series, ch, !!reference);

  const body: Record<string, unknown> = { prompt, aspect_ratio: "3:2", n: 1 };
  if (reference) body.input_references = [{ type: "image_url", image_url: { url: reference } }];
  const res = await openRouterRequest(state, body, undefined, OPENROUTER_IMAGES_URL, state.settings.imageModel);
  const json = await res.json().catch(() => null);
  const item = json?.data?.[0];
  if (item?.b64_json) return `data:${item.media_type || "image/png"};base64,${item.b64_json}`;
  if (item?.url) {
    if (String(item.url).startsWith("data:")) return item.url;
    const img = await fetch(item.url).catch(() => null);
    if (img?.ok) return blobToDataUrl(await img.blob());
  }
  throw new Error(json?.error?.message ? `Illustration failed: ${json.error.message}` : "The image model returned no picture. Try again or pick another image model in Settings.");
}

// ---------- dictionary card fallback (when Wiktionary has no entry) ----------

/** Writes a dictionary entry with the story model, in the reader's translation language. */
export async function aiDictionaryCard(state: State, lemma: string): Promise<DictCard> {
  const question = dictQuestion(state.settings.lang, lemma);
  let text: string;
  if (state.settings.provider === "openrouter") {
    const res = await openRouterRequest(state, {
      reasoning: { effort: "low" },
      response_format: { type: "json_schema", json_schema: { name: "entry", strict: true, schema: DICT_SCHEMA } },
      messages: [{ role: "user", content: question }],
    });
    const json = await res.json().catch(() => null);
    text = String(json?.choices?.[0]?.message?.content ?? "");
  } else {
    text = await anthropicLookup(state, question, DICT_SCHEMA);
  }
  return parseDict(text, lemma);
}
