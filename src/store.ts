// Data model + persistence (everything lives in this device's localStorage).

export interface Sentence {
  fi: string;
  tr: string;
}

export interface GlossEntry {
  lemma: string;
  tr: string;
  note: string;
  name?: boolean;
}

export type Feedback = "easy" | "right" | "hard";

export interface Chapter {
  id: string;
  title: string;
  titleTr: string;
  paragraphs: Sentence[][];
  /** keyed by lowercased word form exactly as it appears in the text */
  glossary: Record<string, GlossEntry>;
  /** level the chapter was written for */
  level: number;
  /** lemmas the reader looked up */
  lookedUp: string[];
  /** "p.s" ids of sentences whose translation was revealed */
  peeked: string[];
  finished: boolean;
  feedback?: Feedback;
  levelDelta?: number;
}

export interface Series {
  id: string;
  title: string;
  premise: string;
  genre: string;
  /** running summary used to keep continuity between chapters */
  storySoFar: string;
  chapters: Chapter[];
  createdAt: number;
  sample?: boolean;
}

export interface WordStat {
  tr: string;
  seen: number;
  lookups: number;
  /** consecutive chapters read without looking the word up */
  streak: number;
  known: boolean;
  lastSeen: number;
}

export interface Settings {
  onboarded: boolean;
  apiKey: string;
  model: string;
  /** language translations are shown in */
  lang: string;
  /** 0.5 (absolute beginner) … 6 (C2); 1 = A1, 2 = A2, 3 = B1 … */
  level: number;
  interests: string;
  fontSize: number;
}

export interface State {
  settings: Settings;
  series: Series[];
  words: Record<string, WordStat>;
}

const KEY = "taskututtor.v1";

export const MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 — best stories" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 — faster, cheaper" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 — fastest, cheapest" },
];

function defaults(): State {
  return {
    settings: {
      onboarded: false,
      apiKey: "",
      model: MODELS[0].id,
      lang: "English",
      level: 1,
      interests: "",
      fontSize: 20,
    },
    series: [],
    words: {},
  };
}

export function load(): State {
  const base = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw) as Partial<State>;
    return {
      settings: { ...base.settings, ...saved.settings },
      series: saved.series ?? [],
      words: saved.words ?? {},
    };
  } catch {
    return base;
  }
}

export function save(state: State): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Split a sentence into word and non-word tokens. Words keep inner - ' : (EU:n, maanantai-ilta). */
const WORD = /[\p{L}\p{N}]+(?:[-'’:][\p{L}\p{N}]+)*/gu;

export function tokenize(text: string): { text: string; word: boolean }[] {
  const out: { text: string; word: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(WORD)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ text: text.slice(last, i), word: false });
    out.push({ text: m[0], word: true });
    last = i + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), word: false });
  return out;
}

export function formKey(word: string): string {
  return word.toLowerCase().replace(/’/g, "'");
}

/** Distinct, non-name lemmas of a chapter (words missing from the glossary are skipped). */
export function chapterLemmas(ch: Chapter): Map<string, string> {
  const lemmas = new Map<string, string>();
  for (const p of ch.paragraphs)
    for (const s of p)
      for (const t of tokenize(s.fi)) {
        if (!t.word) continue;
        const g = ch.glossary[formKey(t.text)];
        if (g && !g.name && !/^\d/.test(g.lemma)) lemmas.set(g.lemma.toLowerCase(), g.tr);
      }
  return lemmas;
}
