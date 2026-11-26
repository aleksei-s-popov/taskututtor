// Difficulty adaptation: turns reading behaviour into a level and a word-knowledge model.

import { chapterLemmas, type Chapter, type Feedback, type State } from "./store";

export const MIN_LEVEL = 0.5;
export const MAX_LEVEL = 6;

const CEFR = ["A1", "A2", "B1", "B2", "C1", "C2"];

export function cefr(level: number): string {
  if (level < 0.9) return "Pre-A1";
  const i = Math.min(5, Math.floor(level + 0.1) - 1);
  const frac = level - (i + 1);
  return CEFR[i] + (frac >= 0.45 && i < 5 ? "+" : "");
}

export interface ChapterResult {
  delta: number;
  lookupRate: number;
  uniqueWords: number;
  lookedUp: number;
  newlyKnown: number;
  quiz: { right: number; total: number };
}

/** YKI intermediate level 3 (B1) is the usual target, e.g. for Finnish citizenship. */
export const YKI_TARGET = 3;

/** Progress from absolute beginner to the YKI target, 0–1. */
export function ykiProgress(level: number): number {
  return Math.min(1, Math.max(0, (level - MIN_LEVEL) / (YKI_TARGET - MIN_LEVEL)));
}

/**
 * Comprehensible input works best when ~95–98% of the words are understood.
 * We aim for the reader looking up roughly 2–8% of the distinct words.
 */
export function levelDelta(lookupRate: number, peekRate: number, feedback: Feedback, quiz?: { right: number; total: number }): number {
  let d = 0;
  if (feedback === "easy") d += 0.3;
  if (feedback === "hard") d -= 0.3;

  if (lookupRate < 0.02) d += 0.15;
  else if (lookupRate <= 0.08) d += feedback === "right" ? 0.05 : 0;
  else if (lookupRate <= 0.15) d -= 0.1;
  else d -= 0.25;

  if (peekRate > 0.3) d -= 0.1;

  // Comprehension questions: missing most of them means the text was not really understood,
  // however few words were looked up.
  if (quiz && quiz.total >= 2) {
    const share = quiz.right / quiz.total;
    if (share < 0.5) d -= 0.15;
    else if (share === 1) d += 0.05;
  }
  return Math.round(d * 100) / 100;
}

/** Records a finished chapter: updates word knowledge and the reader's level. */
export function finishChapter(state: State, ch: Chapter, feedback: Feedback): ChapterResult {
  const lemmas = chapterLemmas(ch);
  const looked = new Set(ch.lookedUp);
  const now = Date.now();
  let newlyKnown = 0;

  for (const [lemma, tr] of lemmas) {
    const w = (state.words[lemma] ??= { tr, seen: 0, lookups: 0, streak: 0, known: false, lastSeen: now });
    w.seen++;
    w.lastSeen = now;
    w.tr = tr;
    if (looked.has(lemma)) {
      w.lookups++;
      w.streak = 0;
      w.known = false;
    } else {
      w.streak++;
      // Read three chapters in a row without needing help → treat as known.
      if (!w.known && w.streak >= 3) {
        w.known = true;
        newlyKnown++;
      }
    }
  }

  const sentences = ch.paragraphs.reduce((n, p) => n + p.length, 0);
  const lookedCount = [...looked].filter((l) => lemmas.has(l)).length;
  const lookupRate = lemmas.size ? lookedCount / lemmas.size : 0;
  const peekRate = sentences ? ch.peeked.length / sentences : 0;
  const answered = (ch.questions ?? []).map((q, i) => ({ q, a: ch.answers?.[i] })).filter((x) => x.a !== undefined && x.a !== null);
  const quiz = { right: answered.filter((x) => x.a === x.q.answer).length, total: answered.length };
  const delta = levelDelta(lookupRate, peekRate, feedback, quiz);

  const before = state.settings.level;
  state.settings.level = Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.round((before + delta) * 100) / 100));

  ch.finished = true;
  ch.feedback = feedback;
  ch.levelDelta = Math.round((state.settings.level - before) * 100) / 100;

  return { delta: ch.levelDelta, lookupRate, uniqueWords: lemmas.size, lookedUp: lookedCount, newlyKnown, quiz };
}

/** Words the reader is still learning: looked up and not yet known. Most recent first. */
export function learningWords(state: State): [string, State["words"][string]][] {
  return Object.entries(state.words)
    .filter(([, w]) => w.lookups > 0 && !w.known)
    .sort((a, b) => b[1].lastSeen - a[1].lastSeen);
}

export function knownCount(state: State): number {
  return Object.values(state.words).filter((w) => w.known).length;
}
