// Story generation and on-demand lookups, called straight from the browser with the reader's own
// API key: through OpenRouter (default, any model) or the Anthropic API directly.

import Anthropic from "@anthropic-ai/sdk";
import { cefr, learningWords } from "./adapt";
import { formKey, tokenize, uid, type Chapter, type GlossEntry, type Series, type State } from "./store";

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

/** Concrete writing constraints for a level (1 = A1 … 5 = C1). */
function levelBrief(level: number): { words: number; brief: string } {
  if (level < 0.9)
    return {
      words: 90,
      brief:
        "Absolute beginner (pre-A1). Only the ~200 most frequent words, plus international/cognate words and names. Sentences of 3–6 words. Present tense, basic verb type 1, olla, minulla on. Nominative, a few -ssa/-lla forms. Heavy repetition of the same words and patterns.",
    };
  if (level < 1.5)
    return {
      words: 150,
      brief:
        "A1. The ~500 most frequent words. Sentences of 4–8 words. Present tense, negation, basic questions, the common local cases, genitive, simple partitive. No past tense yet except olla (oli). Repeat key words several times.",
    };
  if (level < 2.5)
    return {
      words: 260,
      brief:
        "A2. The ~1500 most frequent words. Sentences of 6–12 words. Imperfect (past) tense, all common cases, object forms, simple että/koska/kun clauses, modal verbs (täytyy, voi, haluaa). Mostly standard written Finnish; dialogue may use light spoken forms.",
    };
  if (level < 3.5)
    return {
      words: 420,
      brief:
        "B1. The ~3000 most frequent words. Varied sentence length. Perfect and pluperfect, conditional, passive, relative clauses, common infinitive structures. Dialogue may use natural spoken Finnish (mä, sä, oon).",
    };
  if (level < 4.5)
    return {
      words: 600,
      brief:
        "B2. Rich everyday and some abstract vocabulary, idioms. Participles, more complex clause structures, natural spoken Finnish in dialogue. Still noticeably simpler than a native novel.",
    };
  return {
    words: 800,
    brief:
      "C1+. Close to native literary prose: wide vocabulary, idioms, participial constructions, stylistic variety. Only rare or archaic vocabulary needs avoiding.",
  };
}

const SYSTEM = `You write serialized fiction for an adult learning Finnish through comprehensible input (extensive reading). You are both a gripping storyteller and an expert in Finnish as a second language.

Craft:
- The story must be genuinely hard to put down: a protagonist who wants something, real stakes, secrets, tension, surprises, humour and warmth. Never write a textbook dialogue or a lesson in disguise.
- Start in the middle of something happening. Lots of dialogue and concrete action. End every chapter on a hook or cliffhanger that makes the reader need the next one.
- Keep continuity with the story so far: same characters, facts and open threads. Move the plot forward meaningfully each chapter.

Language:
- Write natural, correct Finnish that a native would accept, graded precisely to the stated level. Simplicity comes from word choice, short sentences and repetition — never from broken grammar.
- The text should sit slightly above the reader's level: roughly 95% of running words should be familiar at that level, with about 5% new, guessable from context where possible.
- Reuse new and "still learning" words several times within the chapter so they stick.
- Respect the target chapter length.

Output:
- paragraphs: the chapter split into paragraphs, each a list of sentences. Each sentence has the Finnish text ("fi", with its punctuation and quotation marks) and a natural translation ("tr") in the reader's translation language. A line of dialogue with its speech tag is one sentence.
- glossary: one entry for EVERY distinct word form that appears in the Finnish text (function words and names too). "form" is the word exactly as written in the text, lowercased, without surrounding punctuation; hyphenated compounds and forms like "EU:n" are a single form. "lemma" is the dictionary form. "tr" is a short translation of this form as used here, in the translation language. "note" is a very short grammar hint in the translation language (e.g. "inessive of talo", "past, 3rd sg of mennä") or "" when the form is already the dictionary form. "name" is true for proper names.
- story_so_far: an updated summary in English (max 180 words) of the whole story up to and including this chapter — characters, key facts, open threads — written for yourself to continue the story later.`;

const CHAPTER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["series_title", "series_premise", "chapter_title", "chapter_title_tr", "paragraphs", "glossary", "story_so_far"],
  properties: {
    series_title: { type: "string", description: "Series title in Finnish" },
    series_premise: { type: "string", description: "One-sentence spoiler-free teaser in the translation language" },
    chapter_title: { type: "string", description: "Chapter title in Finnish" },
    chapter_title_tr: { type: "string" },
    paragraphs: {
      type: "array",
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["fi", "tr"],
          properties: { fi: { type: "string" }, tr: { type: "string" } },
        },
      },
    },
    glossary: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["form", "lemma", "tr", "note", "name"],
        properties: {
          form: { type: "string" },
          lemma: { type: "string" },
          tr: { type: "string" },
          note: { type: "string" },
          name: { type: "boolean" },
        },
      },
    },
    story_so_far: { type: "string" },
  },
};

interface ChapterPayload {
  series_title: string;
  series_premise: string;
  chapter_title: string;
  chapter_title_tr: string;
  paragraphs: { fi: string; tr: string }[][];
  glossary: { form: string; lemma: string; tr: string; note: string; name: boolean }[];
  story_so_far: string;
}

export interface NewSeriesRequest {
  genre: string;
  idea: string;
}

function buildPrompt(state: State, series: Series | null, req: NewSeriesRequest | null): string {
  const { level, lang, interests } = state.settings;
  const lb = levelBrief(level);
  const learning = learningWords(state).slice(0, 60).map(([lemma]) => lemma);
  const known = Object.values(state.words).filter((w) => w.known).length;

  const lines: string[] = [
    `Reader's level: ${level.toFixed(2)} on a scale where 1.0 = A1, 2.0 = A2, 3.0 = B1, 4.0 = B2, 5.0 = C1 (≈ ${cefr(level)}).`,
    `Writing constraints for this level: ${lb.brief}`,
    `Target chapter length: about ${lb.words} Finnish words.`,
    `Translation language: ${lang}.`,
  ];
  if (interests.trim()) lines.push(`Reader's interests: ${interests.trim()}`);
  if (known) lines.push(`The reader has shown they know about ${known} word families so far.`);
  if (learning.length)
    lines.push(
      `Words the reader recently had to look up and is still learning — weave a good handful of these back in naturally (do not force all of them): ${learning.join(", ")}`,
    );

  const last = series?.chapters.at(-1);
  if (last?.finished && last.feedback) {
    const note =
      last.feedback === "easy"
        ? "The reader found the previous chapter too easy — stretch them a little more."
        : last.feedback === "hard"
          ? "The reader found the previous chapter too hard — make this one clearly more accessible: shorter sentences, more familiar words, more repetition."
          : "The reader found the previous chapter about right.";
    lines.push(note);
  }

  if (series && series.chapters.length) {
    lines.push(
      "",
      `Continue the series "${series.title}" (${series.genre}). Write chapter ${series.chapters.length + 1}.`,
      `Premise: ${series.premise}`,
      `Story so far: ${series.storySoFar}`,
    );
    if (last) {
      lines.push(
        `Previous chapter ("${last.title}") in full, so you can pick up exactly where it ended:`,
        last.paragraphs.map((p) => p.map((s) => s.fi).join(" ")).join("\n"),
      );
    }
    lines.push(`Return series_title "${series.title}" and the same premise unchanged.`);
  } else if (req) {
    lines.push(
      "",
      `Start a brand-new series and write chapter 1. Genre: ${req.genre}.`,
      req.idea.trim() ? `The reader's idea for it: ${req.idea.trim()}` : "Invent a fresh, specific premise — avoid clichés.",
      "Set it somewhere that lets Finnish life and culture show through when that fits the genre.",
    );
    const titles = state.series.map((s) => s.title);
    if (titles.length) lines.push(`Make it different from the reader's existing series: ${titles.join("; ")}.`);
  }
  return lines.join("\n");
}

function toChapter(p: ChapterPayload, level: number): Chapter {
  const glossary: Record<string, GlossEntry> = {};
  for (const g of p.glossary) {
    const entry: GlossEntry = { lemma: g.lemma, tr: g.tr, note: g.note };
    if (g.name) entry.name = true;
    glossary[formKey(g.form.trim())] = entry;
  }
  const paragraphs = p.paragraphs
    .map((para) => para.filter((s) => s.fi.trim()).map((s) => ({ fi: s.fi.trim(), tr: s.tr.trim() })))
    .filter((para) => para.length);
  if (!paragraphs.length) throw new Error("The story came back empty. Please try again.");
  return {
    id: uid(),
    title: p.chapter_title,
    titleTr: p.chapter_title_tr,
    paragraphs,
    glossary,
    level,
    lookedUp: [],
    peeked: [],
    finished: false,
  };
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
    if (!payload || !Array.isArray(payload.paragraphs) || !Array.isArray(payload.glossary))
      throw new Error("The story came back in an unexpected format. Please try again.");
    return { chapter: toChapter(payload, level), payload };
  });
  return { promise, cancel: run.cancel };
}

/** Parses a JSON object, tolerating code fences or stray text around it. */
function parseJson<T>(text: string): T | null {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(text.slice(a, b + 1)) as T;
  } catch {
    return null;
  }
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

async function openRouterRequest(state: State, body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal,
      headers: { Authorization: `Bearer ${state.settings.orKey}`, "Content-Type": "application/json", "X-Title": "Taskututtor" },
      body: JSON.stringify({ model: state.settings.orModel, ...body }),
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
  if (res.status === 404 || res.status === 400) throw new Error(`OpenRouter couldn't run "${state.settings.orModel}": ${detail || "check the model name in Settings."}`);
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

const LOOKUP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["lemma", "tr", "note", "name"],
  properties: {
    lemma: { type: "string" },
    tr: { type: "string" },
    note: { type: "string" },
    name: { type: "boolean" },
  },
};

/** Fallback for a word that is missing from a chapter's glossary. */
export async function lookupWord(state: State, word: string, sentence: string): Promise<GlossEntry> {
  const question = `Finnish word: "${word}"\nIn the sentence: "${sentence}"\n\nGive its dictionary form (lemma), a short translation into ${state.settings.lang} as used in this sentence (tr), a very short grammar hint in ${state.settings.lang} (note, "" if it is already the dictionary form), and whether it is a proper name.`;
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
    text = await anthropicLookup(state, question);
  }
  const g = parseJson<GlossEntry & { name: boolean }>(text);
  if (!g || !g.tr) throw new Error("Couldn't look that word up.");
  const entry: GlossEntry = { lemma: g.lemma || word, tr: g.tr, note: g.note ?? "" };
  if (g.name) entry.name = true;
  return entry;
}

async function anthropicLookup(state: State, question: string): Promise<string> {
  const msg = await client(state).messages.create({
    model: state.settings.model,
    max_tokens: 16000,
    output_config: { effort: "low", format: { type: "json_schema", schema: LOOKUP_SCHEMA } },
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
