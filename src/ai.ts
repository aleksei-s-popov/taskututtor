// Story generation and on-demand lookups, called straight from the browser with the reader's own
// API key: through OpenRouter (default, any model) or the Anthropic API directly.

import Anthropic from "@anthropic-ai/sdk";
import { cefr, learningWords } from "./adapt";
import type { DictCard } from "./dict";
import { formKey, seriesNames, tokenize, uid, type Chapter, type GlossEntry, type Series, type State } from "./store";

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
      words: 120,
      brief:
        "Absolute beginner (pre-A1). Only the ~200 most frequent words, plus international/cognate words and names. Sentences of 3–6 words. Present tense, basic verb type 1, olla, minulla on. Nominative, a few -ssa/-lla forms. Repeat the same words and sentence patterns a lot — but never the same events.",
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
- The story must be genuinely hard to put down: a protagonist who wants something and acts to get it, real stakes, secrets, surprises, humour and warmth. Let the reader's interests shape the tone and themes. Never write a textbook dialogue or a lesson in disguise.
- Every series follows a secret plan: you decide up front what is really going on and how it ends, then tell it over a fixed number of chapters. Mysteries are only satisfying because they get answered — plant questions AND pay them off on schedule.
- Every chapter must change the situation irreversibly. By its end at least one of these has happened: a question is answered, a secret comes out, the characters are in a new place, someone new enters, a decision is made that cannot be undone, something is won or lost. A chapter that only adds more mystery, more threats or more "who is lying?" is a failed chapter.
- Never repeat a beat. Check the chapter log: if something like it already happened (another knock, another voice, another warning, another object that moves), do something different. Do not let characters stand in the same room reacting for chapter after chapter — move through places, time and events. Time jumps and scene changes are welcome.
- Open each chapter by resolving the previous chapter's hook within the first few sentences — show what actually happened. Then move on to this chapter's planned event. End on a new hook of a different kind than last time (a discovery, a choice, an arrival, a reversal — not always a threat).
- Stay consistent: characters, facts and rules established earlier remain true. If the canon says the cat can talk, it does not surprise anyone later. Never contradict the secret truth of the plan.
- A simple vocabulary is no excuse for a static plot: with 200 words people can still run, find, steal, meet, lie, travel, lose and win.

Language:
- Write natural, correct Finnish that a native would accept, graded precisely to the stated level. Simplicity comes from word choice, short sentences and repetition — never from broken grammar.
- The text should sit slightly above the reader's level: roughly 95% of running words should be familiar at that level, with about 5% new, guessable from context where possible.
- Reuse new words several times within the chapter so they stick. "Still learning" words from earlier chapters are optional seasoning: use them only where the new events call for them, and never bend or stall the plot to fit them in.
- Before you answer, proofread every Finnish sentence as a strict native editor: verb forms after the negative verb (ei naura, not "ei nauraa"), cases required by verbs and postpositions (oven takana, not "taakse ovea"), possessive suffixes (hänen jalkansa), object cases. Fix anything a native would not write.
- Respect the target chapter length.

Output:
- paragraphs: the chapter split into paragraphs, each a list of sentences. Each sentence has the Finnish text ("fi", with its punctuation and quotation marks) and a natural translation ("tr") in the reader's translation language. A line of dialogue with its speech tag is one sentence.
- glossary: one entry for EVERY distinct word form that appears in the Finnish text (function words and names too). "form" is the word exactly as written in the text, lowercased, without surrounding punctuation; hyphenated compounds and forms like "EU:n" are a single form. "lemma" is the dictionary form. "tr" is a short translation of this form as used here, in the translation language. "note" is a very short grammar hint in the translation language (e.g. "inessive of talo", "past, 3rd sg of mennä") or "" when the form is already the dictionary form. "name" is true for proper names.
- story_so_far: the series canon in English (max 250 words), updated to include this chapter and written for yourself: who the characters are and what each wants, facts and rules established so far, where everyone is right now, which questions have been ANSWERED (with the answer) and which are still open. Drop atmosphere; keep facts.
- chapter_recap: one English sentence (max 30 words) stating what concretely happened and changed in this chapter.
- plan: the secret plot plan. When you are asked to create a plan, fill it in: "truth" = what is really going on and why (the answer to the central mystery; 2–4 sentences), "ending" = how the arc ends, "beats" = one entry per remaining chapter of the arc, in order, starting with the chapter you are writing now — each a concrete event that changes the situation, with its location; the last beat resolves the central conflict. When you are given an existing plan to follow, return empty strings and an empty beats list.
- art_bible: in English, the fixed visual identity of the series for an illustrator (max 150 words): one consistent art style (medium, palette, mood) that suits the genre, then the exact unchanging look of each recurring character (age, build, hair, face, signature clothing) and key locations. For a continuing series you are given the existing art bible: return it word for word, only appending newly introduced recurring characters or locations.
- illustration_scene: in English, one visually striking moment from this chapter for a single illustration (max 60 words): who is in frame, what they are doing, setting, light and mood. Do not give away the chapter's final twist.`;

const CHAPTER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["series_title", "series_premise", "chapter_title", "chapter_title_tr", "paragraphs", "glossary", "story_so_far", "art_bible", "illustration_scene", "chapter_recap", "plan"],
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
    art_bible: { type: "string" },
    illustration_scene: { type: "string" },
    chapter_recap: { type: "string" },
    plan: {
      type: "object",
      additionalProperties: false,
      required: ["truth", "ending", "beats"],
      properties: {
        truth: { type: "string" },
        ending: { type: "string" },
        beats: { type: "array", items: { type: "string" } },
      },
    },
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
  art_bible: string;
  illustration_scene: string;
  chapter_recap: string;
  plan: { truth: string; ending: string; beats: string[] };
}

export interface NewSeriesRequest {
  genre: string;
  idea: string;
  /** an earlier series whose world and characters the new story should share */
  from?: Series;
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
      `Words the reader recently looked up and is still learning (optional — use some only where this chapter's new events naturally need them): ${learning.join(", ")}`,
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
    const n = series.chapters.length; // index of the chapter being written
    lines.push(
      "",
      `Continue the series "${series.title}" (${series.genre}). Write chapter ${n + 1}.`,
      `Premise: ${series.premise}`,
      `Canon so far: ${series.storySoFar}`,
    );
    const log = series.chapters.map((c, i) => `${i + 1}. ${c.recap || `"${c.titleTr || c.title}"`}`);
    lines.push("Chapter log (what already happened — do not repeat any of it):", log.join("\n"));

    const plan = series.plan;
    const beat = plan ? n - plan.start : -1;
    if (plan && beat >= 0 && beat < plan.beats.length) {
      const final = beat === plan.beats.length - 1;
      lines.push(
        "",
        "SECRET PLAN for this arc (follow it; never reveal anything before its beat):",
        `Truth: ${plan.truth}`,
        `Ending: ${plan.ending}`,
        plan.beats.map((b, i) => `${plan.start + i + 1}. ${b}${i < beat ? " (done)" : i === beat ? "  ← WRITE THIS NOW" : ""}`).join("\n"),
        final
          ? "This is the FINAL chapter of the arc: resolve the central conflict and answer the remaining open questions. Give a satisfying ending — no cliffhanger (a light closing note is fine)."
          : `This chapter must deliver beat ${plan.start + beat + 1} in full, and end on a hook that leads to beat ${plan.start + beat + 2}.`,
        "You are following an existing plan: return plan with empty strings and an empty beats list.",
      );
    } else if (plan) {
      lines.push(
        "",
        `The previous story arc has ended (truth: ${plan.truth} Ending: ${plan.ending}).`,
        "Create a NEW plan for a sequel arc of 8–12 chapters with the same main characters but a fresh central conflict, new places and new stakes. Its first beat is the chapter you write now.",
      );
    } else {
      lines.push(
        "",
        "This series has NO plan and has been stalling: recent chapters repeated the same situation and kept adding questions without answering any.",
        "Fix it now. Create a plan that brings the story to a real ending in 6–8 more chapters: decide the truth that explains what has happened so far (honouring the canon), then beats in which the open questions are answered one by one, the characters leave the current location, and things actually change. The first beat is the chapter you write now, and it must break the deadlock with a decisive event — starting by showing what the previous chapter's hook really was.",
      );
    }
    if (last) {
      lines.push(
        "",
        `Previous chapter ("${last.title}") in full, so you can pick up exactly where it ended:`,
        last.paragraphs.map((p) => p.map((s) => s.fi).join(" ")).join("\n"),
      );
    }
    lines.push(`Return series_title "${series.title}" and the same premise unchanged.`);
    lines.push(series.artBible ? `Existing art bible (return unchanged, only append new recurring characters/locations): ${series.artBible}` : "There is no art bible yet: write one that fits the story so far.");
  } else if (req?.from) {
    const src = req.from;
    lines.push(
      "",
      `Start a NEW, separate story set in the same world as the reader's earlier series "${src.title}", and write its chapter 1. Genre: ${req.genre}.`,
      req.idea.trim()
        ? `The reader's wish for it (including which character to follow, if they say): ${req.idea.trim()}`
        : "Follow one or more of its established characters — the protagonist, or a side character who deserves their own story.",
      `Canon of "${src.title}" — everything here stays true; returning characters keep their personality, history and relationships: ${src.storySoFar}`,
    );
    if (src.plan) lines.push(`What was really going on in that series, and how it ended: ${src.plan.truth} ${src.plan.ending}`);
    lines.push(
      "This is a new adventure, not a retelling or a direct continuation of the old plot: a fresh central conflict, new places, new stakes, and at least one important new character. A reader who remembers the earlier series should recognise the characters and enjoy small callbacks; a reader who forgot it should still follow everything.",
      "Give it its own series title and premise.",
      "Create the secret plan for a complete story of 9–12 chapters: the truth behind it, the ending, and one beat per chapter (beat 1 is this chapter). Vary locations and kinds of events across the beats; put a major reveal or reversal around the middle.",
      src.artBible
        ? `Art bible of the earlier series — keep its style and the exact looks of returning characters, and add the new characters and locations: ${src.artBible}`
        : "",
    );
  } else if (req) {
    lines.push(
      "",
      `Start a brand-new series and write chapter 1. Genre: ${req.genre}.`,
      req.idea.trim() ? `The reader's idea for it: ${req.idea.trim()}` : "Invent a fresh, specific premise — avoid clichés.",
      "Set it somewhere that lets Finnish life and culture show through when that fits the genre.",
      "Create the secret plan for a complete story of 9–12 chapters: the truth behind it, the ending, and one beat per chapter (beat 1 is this chapter). Vary locations and kinds of events across the beats; put a major reveal or reversal around the middle.",
    );
    if (state.series.length) {
      const used = [...new Set(state.series.flatMap((s) => seriesNames(s).slice(0, 8)))];
      lines.push(
        "This must be a completely different story from the reader's existing series, with an entirely new cast and world: a new protagonist who differs clearly in name, age, gender or occupation and personality, a different kind of setting (not the same city-flat setup again), and a different central idea.",
        `Existing series: ${state.series.map((s) => `"${s.title}" — ${s.premise}`).join(" | ")}`,
        used.length ? `Names of people and places from earlier series: ${used.join(", ")}. No character in the new story may have any of these names, and its main setting must be a different place.` : "",
      );
    }
  }
  return lines.filter((l, i) => l || i === lines.indexOf("")).join("\n");
}

function toChapter(p: ChapterPayload, level: number): Chapter {
  const glossary: Record<string, GlossEntry> = {};
  for (const g of p.glossary) {
    const entry: GlossEntry = { lemma: g.lemma, tr: g.tr, note: g.note };
    if (g.name) entry.name = true;
    // Models sometimes leave punctuation on the form ("ei!", "sanoo:").
    glossary[formKey(g.form.trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))] = entry;
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
    scene: p.illustration_scene || undefined,
    recap: p.chapter_recap || undefined,
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
    text = await anthropicLookup(state, question, LOOKUP_SCHEMA);
  }
  const g = parseJson<GlossEntry & { name: boolean }>(text);
  if (!g || !g.tr) throw new Error("Couldn't look that word up.");
  const entry: GlossEntry = { lemma: g.lemma || word, tr: g.tr, note: g.note ?? "" };
  if (g.name) entry.name = true;
  return entry;
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

const DEFAULT_STYLE =
  "Painterly digital book illustration with soft natural light and a muted Nordic palette; cinematic composition; the same style in every picture.";

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
  const scene =
    ch.scene ??
    `A key moment from early in this chapter (not its ending). Chapter "${ch.titleTr || ch.title}": ${ch.paragraphs
      .flat()
      .map((s) => s.tr || s.fi)
      .join(" ")
      .slice(0, 700)}`;
  const prompt = [
    `An illustration for one chapter of the serialized story "${series.title}" (${series.genre}).`,
    `Art direction — identical in every illustration of this series: ${series.artBible || `${DEFAULT_STYLE} Story: ${series.premise}`}`,
    `Scene to illustrate: ${scene}`,
    reference
      ? "The attached image is an earlier illustration from the same series. Match its art style, palette and rendering exactly, and draw any recurring character with exactly the same face, hair, build and clothing. Compose a new scene — do not copy its composition."
      : "",
    "Wide landscape format (3:2). Absolutely no text, letters, captions, speech bubbles, signatures, watermarks or borders in the image.",
  ]
    .filter(Boolean)
    .join("\n\n");

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

const DICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["entries"],
  properties: {
    entries: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["pos", "senses"],
        properties: {
          pos: { type: "string" },
          senses: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["def", "examples"],
              properties: {
                def: { type: "string" },
                examples: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["fi", "tr"],
                    properties: { fi: { type: "string" }, tr: { type: "string" } },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

/** Writes a dictionary entry with the story model, in the reader's translation language. */
export async function aiDictionaryCard(state: State, lemma: string): Promise<DictCard> {
  const lang = state.settings.lang;
  const question = `Write a learner's dictionary entry for the Finnish word "${lemma}". Group by part of speech (pos, named in ${lang}). For each part of speech list its meanings from most to least common (at most 5): "def" is the meaning in ${lang}; "examples" has one or two short, natural Finnish example sentences ("fi") with their ${lang} translation ("tr"). If it is not a real Finnish word, return an empty entries list.`;
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
  const parsed = parseJson<{ entries: DictCard["entries"] }>(text);
  const entries = (parsed?.entries ?? []).filter((e) => e.senses?.length);
  if (!entries.length) throw new Error("Couldn't write a dictionary entry for this word.");
  return { lemma, source: "ai", entries };
}
