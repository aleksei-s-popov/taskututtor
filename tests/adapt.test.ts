import { describe, expect, it } from "vitest";
import { cefr, finishChapter, learningWords, levelDelta, MAX_LEVEL, MIN_LEVEL, ykiProgress } from "../src/adapt";
import { chapter, state } from "./helpers";

describe("levelDelta", () => {
  it("raises the level when the chapter was easy and few words were looked up", () => {
    expect(levelDelta(0, 0, "easy")).toBeGreaterThan(0.3);
  });

  it("lowers the level when the chapter was hard or many words were looked up", () => {
    expect(levelDelta(0.05, 0, "hard")).toBeLessThan(0);
    expect(levelDelta(0.3, 0, "right")).toBeLessThan(0);
  });

  it("drifts slowly upward in the sweet spot, so texts stay slightly above the reader", () => {
    expect(levelDelta(0.05, 0, "right")).toBe(0.05);
  });

  it("counts failed comprehension questions against the reader even with no lookups", () => {
    const without = levelDelta(0.05, 0, "right");
    expect(levelDelta(0.05, 0, "right", { right: 0, total: 3 })).toBeLessThan(without);
    expect(levelDelta(0.05, 0, "right", { right: 3, total: 3 })).toBeGreaterThan(without);
  });

  it("ignores a single answered question", () => {
    expect(levelDelta(0.05, 0, "right", { right: 0, total: 1 })).toBe(levelDelta(0.05, 0, "right"));
  });
});

describe("finishChapter", () => {
  const words = ["*Aino=Aino", "katsoo=katsoa", "ovea=ovi", "ovi=ovi"];

  it("records lookups, exposures and skips names", () => {
    const s = state();
    const ch = chapter("1", ["Aino katsoo ovea.", "Ovi!"], words, { lookedUp: ["ovi"] });
    const result = finishChapter(s, ch, "right");
    expect(result.uniqueWords).toBe(2);
    expect(result.lookedUp).toBe(1);
    expect(s.words.ovi).toMatchObject({ seen: 1, lookups: 1, streak: 0, known: false });
    expect(s.words.katsoa).toMatchObject({ seen: 1, lookups: 0, streak: 1 });
    expect(s.words.aino).toBeUndefined();
    expect(ch.finished).toBe(true);
    expect(learningWords(s).map(([lemma]) => lemma)).toEqual(["ovi"]);
  });

  it("marks a word known after three chapters without a lookup, and forgets it on a lookup", () => {
    const s = state();
    for (const id of ["1", "2", "3"]) finishChapter(s, chapter(id, ["Aino katsoo ovea."], words), "right");
    expect(s.words.katsoa.known).toBe(true);
    finishChapter(s, chapter("4", ["Aino katsoo ovea."], words, { lookedUp: ["katsoa"] }), "right");
    expect(s.words.katsoa).toMatchObject({ known: false, streak: 0 });
  });

  it("keeps the level inside its bounds", () => {
    const low = state({ level: MIN_LEVEL });
    finishChapter(low, chapter("1", ["Aino katsoo ovea."], words, { lookedUp: ["katsoa", "ovi"] }), "hard");
    expect(low.settings.level).toBe(MIN_LEVEL);
    const high = state({ level: MAX_LEVEL });
    finishChapter(high, chapter("1", ["Aino katsoo ovea."], words), "easy");
    expect(high.settings.level).toBe(MAX_LEVEL);
  });

  it("scores answered comprehension questions", () => {
    const q = { q: "?", tr: "?", options: ["a", "b", "c"], answer: 1 };
    const ch = chapter("1", ["Aino katsoo ovea."], words, { questions: [q, q, q], answers: [1, 0, 1] });
    expect(finishChapter(state(), ch, "right").quiz).toEqual({ right: 2, total: 3 });
  });
});

describe("labels", () => {
  it("names levels", () => {
    expect(cefr(0.5)).toBe("Pre-A1");
    expect(cefr(1)).toBe("A1");
    expect(cefr(2.5)).toBe("A2+");
    expect(cefr(3)).toBe("B1");
  });

  it("measures progress toward the YKI target", () => {
    expect(ykiProgress(0.5)).toBe(0);
    expect(ykiProgress(3)).toBe(1);
    expect(ykiProgress(5)).toBe(1);
  });
});
