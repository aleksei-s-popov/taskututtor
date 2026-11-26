import type { Chapter, GlossEntry, Series, State } from "../src/store";
import type { ChapterPayload } from "../src/story";

/** A chapter from "word=lemma" pairs; a leading * marks a proper name. */
export function chapter(id: string, sentences: string[], words: string[], extra: Partial<Chapter> = {}): Chapter {
  const glossary: Record<string, GlossEntry> = {};
  for (const w of words) {
    const name = w.startsWith("*");
    const [form, lemma] = w.replace("*", "").split("=");
    glossary[form.toLowerCase()] = { lemma: lemma ?? form, tr: `tr:${lemma ?? form}`, note: "", ...(name ? { name: true } : {}) };
  }
  return {
    id,
    title: `Luku ${id}`,
    titleTr: `Chapter ${id}`,
    paragraphs: [sentences.map((fi) => ({ fi, tr: `tr:${fi}` }))],
    glossary,
    level: 1,
    lookedUp: [],
    peeked: [],
    finished: false,
    ...extra,
  };
}

export function series(id: string, chapters: Chapter[], extra: Partial<Series> = {}): Series {
  return { id, title: `Sarja ${id}`, premise: `Premise ${id}`, genre: "Mystery", storySoFar: `Canon ${id}`, chapters, createdAt: 1, ...extra };
}

export function state(extra: Partial<State["settings"]> = {}, all: Series[] = []): State {
  return {
    settings: {
      onboarded: true,
      provider: "openrouter",
      orKey: "",
      orModel: "m",
      apiKey: "",
      model: "m",
      lang: "English",
      level: 1,
      interests: "",
      yki: false,
      fontSize: 20,
      listenGap: 0,
      listenRate: 0.85,
      illustrations: false,
      imageModel: "i",
      ...extra,
    },
    series: all,
    words: {},
  };
}

export function payload(extra: Partial<ChapterPayload> = {}): ChapterPayload {
  return {
    series_title: "Majakka",
    series_premise: "A lighthouse.",
    chapter_title: "Kirje",
    chapter_title_tr: "The Letter",
    paragraphs: [[{ fi: "Liisa löytää kirjeen.", tr: "Liisa finds a letter." }]],
    story_so_far: "Liisa found a letter.",
    art_bible: "Gouache. Liisa: red braid.",
    illustration_scene: "Liisa with a letter.",
    chapter_recap: "Liisa found a letter.",
    plan: { truth: "T", ending: "E", beats: ["A", "B", "C"] },
    questions: [{ q: "Kuka?", tr: "Who?", options: ["Liisa", "Onni", "Aino"], answer: 0 }],
    ...extra,
  };
}

/** A glossary model's answer for the payload() chapter. */
export const glossaryAnswer = JSON.stringify({
  glossary: [
    { form: "liisa", lemma: "Liisa", tr: "Liisa", note: "", name: true },
    { form: "löytää", lemma: "löytää", tr: "finds", note: "", name: false },
    { form: "kirjeen.", lemma: "kirje", tr: "letter", note: "object form (genitive) of kirje", name: false },
  ],
});
