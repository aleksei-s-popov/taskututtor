import { describe, expect, it } from "vitest";
import { arcLength, chapterLemmas, formKey, seriesNames, tokenize } from "../src/store";
import { chapter, series } from "./helpers";

describe("tokenize", () => {
  const words = (text: string) => tokenize(text).filter((t) => t.word).map((t) => t.text);

  it("splits words from punctuation and keeps the text intact", () => {
    const text = "Viestissä lukee: ”Älä avaa ovea!”";
    expect(tokenize(text).map((t) => t.text).join("")).toBe(text);
    expect(words(text)).toEqual(["Viestissä", "lukee", "Älä", "avaa", "ovea"]);
  });

  it("treats hyphenated compounds and colon forms as one word", () => {
    expect(words("On maanantai-ilta, ja EU:n lippu.")).toEqual(["On", "maanantai-ilta", "ja", "EU:n", "lippu"]);
  });
});

describe("glossary helpers", () => {
  it("normalises word forms for lookup", () => {
    expect(formKey("Ovea")).toBe("ovea");
  });

  it("lists a chapter's dictionary forms without names", () => {
    const ch = chapter("1", ["Aino katsoo ovea."], ["*Aino=Aino", "katsoo=katsoa", "ovea=ovi"]);
    expect([...chapterLemmas(ch).keys()]).toEqual(["katsoa", "ovi"]);
  });

  it("collects a series' names, most frequent first", () => {
    const s = series("a", [
      chapter("1", ["Aino on Helsingissä."], ["*Aino=Aino", "*Helsingissä=Helsinki", "on=olla"]),
      chapter("2", ["Aino nukkuu."], ["*Aino=Aino", "nukkuu=nukkua"]),
    ]);
    expect(seriesNames(s)).toEqual(["Aino", "Helsinki"]);
  });

  it("knows how long a planned story runs", () => {
    expect(arcLength(series("a", []))).toBe(0);
    expect(arcLength(series("a", [], { plan: { truth: "", ending: "", beats: ["a", "b"], start: 3 } }))).toBe(5);
  });
});
