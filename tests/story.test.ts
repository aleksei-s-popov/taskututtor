import { describe, expect, it } from "vitest";
import { applyChapter, buildPrompt, illustrationPrompt, parseJson, toChapter } from "../src/story";
import { chapter, payload, series, state } from "./helpers";

const plan = { truth: "The keeper is her brother.", ending: "They reunite.", beats: ["Beat A", "Beat B", "Beat C"], start: 0 };
const ch = (id: string) => chapter(id, ["Aino katsoo ovea."], ["*Aino=Aino", "katsoo=katsoa", "ovea=ovi"], { recap: `Recap ${id}` });

describe("buildPrompt", () => {
  it("asks a new series for a secret plan", () => {
    const prompt = buildPrompt(state(), null, { genre: "Mystery", idea: "" });
    expect(prompt).toContain("Start a brand-new series");
    expect(prompt).toContain("Create the secret plan");
  });

  it("keeps a new story away from earlier casts and settings", () => {
    const prompt = buildPrompt(state({}, [series("a", [ch("1")])]), null, { genre: "Mystery", idea: "" });
    expect(prompt).toContain("entirely new cast");
    expect(prompt).toMatch(/Names of people and places from earlier series: .*Aino/);
  });

  it("writes a returning-characters story against the earlier canon", () => {
    const from = series("a", [ch("1")], { plan, artBible: "Ink. Aino: grey eyes." });
    const prompt = buildPrompt(state({}, [from]), null, { genre: "Mystery", idea: "follow the cat", from });
    expect(prompt).toContain('same world as the reader\'s earlier series "Sarja a"');
    expect(prompt).toContain("Canon a");
    expect(prompt).toContain("follow the cat");
    expect(prompt).toContain("Ink. Aino: grey eyes.");
    expect(prompt).not.toContain("entirely new cast");
  });

  it("follows the plan beat by beat and logs earlier chapters", () => {
    const s = series("a", [ch("1")], { plan });
    const prompt = buildPrompt(state({}, [s]), s, null);
    expect(prompt).toContain("1. Recap 1");
    expect(prompt).toContain("1. Beat A (done)");
    expect(prompt).toContain("2. Beat B  ← WRITE THIS NOW");
    expect(prompt).toContain("return plan with empty strings");
    expect(prompt).not.toContain("FINAL chapter");
  });

  it("ends the story on the last beat", () => {
    const s = series("a", [ch("1"), ch("2")], { plan });
    expect(buildPrompt(state({}, [s]), s, null)).toContain("FINAL chapter of the arc");
  });

  it("plans a sequel once the arc is over", () => {
    const s = series("a", [ch("1"), ch("2"), ch("3")], { plan });
    expect(buildPrompt(state({}, [s]), s, null)).toContain("sequel arc");
  });

  it("gives a young plan-less series a plan, and rescues a long stalled one", () => {
    const young = series("a", [ch("1")]);
    expect(buildPrompt(state({}, [young]), young, null)).toContain("no secret plan yet");
    const old = series("b", [ch("1"), ch("2"), ch("3"), ch("4"), ch("5")]);
    expect(buildPrompt(state({}, [old]), old, null)).toContain("has been stalling");
  });

  it("plans YKI topics into the plot instead of bolting one onto each chapter", () => {
    const fresh = buildPrompt(state({ yki: true }), null, { genre: "Mystery", idea: "" });
    expect(fresh).toContain("Planning for the YKI goal");
    expect(fresh).toContain("exactly 3 multiple-choice");
    expect(fresh).not.toContain("This chapter's YKI theme");

    // Mid-story the plan already carries the topics: no new planning, no forced detours.
    const s = series("a", [ch("1")], { plan });
    const mid = buildPrompt(state({ yki: true }, [s]), s, null);
    expect(mid).not.toContain("Planning for the YKI goal");
    expect(mid).toContain("Never add an errand");

    // A sequel is a new plan, so the topics are planned in again.
    const done = series("b", [ch("1"), ch("2"), ch("3")], { plan });
    expect(buildPrompt(state({ yki: true }, [done]), done, null)).toContain("Planning for the YKI goal");

    const off = buildPrompt(state({ yki: false }), null, { genre: "Mystery", idea: "" });
    expect(off).not.toContain("YKI");
    expect(off).toContain("questions: return an empty list");
  });

  it("asks for a real minimum length and steers away from textbook names", () => {
    const prompt = buildPrompt(state({ level: 1 }), null, { genre: "Mystery", idea: "" });
    expect(prompt).toContain("about 150 Finnish words");
    expect(prompt).toContain("fewer than 128 is too short");
    expect(prompt).toContain("Do not fall back on the names every textbook uses");
  });

  it("tells the writer how the previous chapter was received", () => {
    const s = series("a", [{ ...ch("1"), finished: true, feedback: "hard" }], { plan });
    expect(buildPrompt(state({}, [s]), s, null)).toContain("too hard");
  });
});

describe("toChapter", () => {
  it("builds a chapter and cleans punctuation off glossary forms", () => {
    const c = toChapter(payload(), 1.25);
    expect(c.title).toBe("Kirje");
    expect(c.level).toBe(1.25);
    expect(Object.keys(c.glossary)).toEqual(["liisa", "löytää", "kirjeen"]);
    expect(c.glossary.liisa.name).toBe(true);
    expect(c.recap).toBe("Liisa found a letter.");
    expect(c.finished).toBe(false);
  });

  it("drops malformed questions", () => {
    const c = toChapter(payload({ questions: [{ q: "Kuka?", tr: "", options: ["a", "b", "c"], answer: 7 }, { q: "Mikä?", tr: "", options: ["a", "b", "c"], answer: 2 }] }), 1);
    expect(c.questions?.map((q) => q.q)).toEqual(["Mikä?"]);
  });

  it("rejects an empty story", () => {
    expect(() => toChapter(payload({ paragraphs: [[{ fi: " ", tr: "" }]] }), 1)).toThrow();
  });
});

describe("applyChapter", () => {
  it("creates a series with its plan from chapter 1", () => {
    const p = payload();
    const s = applyChapter(null, toChapter(p, 1), p, { genre: "Mystery", idea: "" });
    expect(s).toMatchObject({ title: "Majakka", genre: "Mystery", storySoFar: "Liisa found a letter.", artBible: "Gouache. Liisa: red braid." });
    expect(s.plan).toMatchObject({ beats: ["A", "B", "C"], start: 0 });
    expect(s.chapters).toHaveLength(1);
  });

  it("does not let the model replace a plan mid-story", () => {
    const s = series("a", [ch("1")], { plan });
    const p = payload({ plan: { truth: "X", ending: "Y", beats: ["new"] } });
    applyChapter(s, toChapter(p, 1), p, null);
    expect(s.plan).toBe(plan);
    expect(s.chapters).toHaveLength(2);
    expect(s.storySoFar).toBe("Liisa found a letter.");
  });

  it("accepts a new plan when there was none or the arc has ended", () => {
    const none = series("a", [ch("1"), ch("2")]);
    const p = payload();
    applyChapter(none, toChapter(p, 1), p, null);
    expect(none.plan).toMatchObject({ beats: ["A", "B", "C"], start: 2 });

    const ended = series("b", [ch("1"), ch("2"), ch("3")], { plan });
    applyChapter(ended, toChapter(p, 1), p, null);
    expect(ended.plan).toMatchObject({ truth: "T", start: 3 });
  });

  it("remembers which series a returning-characters story continues", () => {
    const from = series("a", [ch("1")]);
    const p = payload();
    expect(applyChapter(null, toChapter(p, 1), p, { genre: "Mystery", idea: "", from }).basedOn).toBe("a");
  });
});

describe("parsing and illustration prompts", () => {
  it("reads JSON wrapped in code fences or chatter", () => {
    expect(parseJson<{ a: number }>('Here you go:\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(parseJson("no json here")).toBeNull();
  });

  it("puts the art bible in every picture prompt and matches a reference when given", () => {
    const s = series("a", [ch("1")], { artBible: "Ink and watercolour." });
    const c = { ...ch("2"), scene: "Aino at the door." };
    const alone = illustrationPrompt(s, c, false);
    expect(alone).toContain("Ink and watercolour.");
    expect(alone).toContain("Aino at the door.");
    expect(alone).toContain("No frame");
    expect(alone).not.toContain("attached image");
    expect(illustrationPrompt(s, c, true)).toContain("attached image");
  });
});
