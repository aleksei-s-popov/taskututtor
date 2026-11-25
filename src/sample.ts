// A built-in first chapter so the app is usable before an API key is added.

import type { Chapter, GlossEntry, Series } from "./store";

// form | lemma | translation | note
const GLOSS = `
aino|Aino|Aino|name
asuu|asua|lives|3rd person singular of asua
helsingissä|Helsinki|in Helsinki|name, inessive (-ssa: in)
hän|hän|he / she|
on|olla|is|3rd person singular of olla
kaksikymmentäviisi|kaksikymmentäviisi|twenty-five|
vuotta|vuosi|years|partitive of vuosi (after a number)
vanha|vanha|old|
hänellä|hän|she has (lit. "on her")|adessive of hän; hänellä on = she has
pieni|pieni|small|
asunto|asunto|apartment|
ja|ja|and|
musta|musta|black|
kissa|kissa|cat|
maanantai-ilta|maanantai-ilta|Monday evening|maanantai (Monday) + ilta (evening)
juo|juoda|drinks|3rd person singular of juoda
teetä|tee|tea|partitive of tee
lukee|lukea|reads; (of a text) says|3rd person singular of lukea
kirjaa|kirja|a book|partitive of kirja
nukkuu|nukkua|sleeps|3rd person singular of nukkua
sohvalla|sohva|on the sofa|adessive of sohva (-lla: on)
yhtäkkiä|yhtäkkiä|suddenly|
puhelin|puhelin|phone|
piippaa|piipata|beeps|3rd person singular of piipata
katsoo|katsoa|looks at|3rd person singular of katsoa
puhelinta|puhelin|the phone|partitive of puhelin
numero|numero|number|
outo|outo|strange|
avaa|avata|opens / open|3rd person singular of avata; with älä: "don't open"
viestin|viesti|the message|genitive (object form) of viesti
viestissä|viesti|in the message|inessive of viesti
älä|ei|don't|negative imperative, 2nd person singular
ovea|ovi|the door|partitive of ovi
tänä|tämä|this|essive of tämä; tänä iltana = this evening
iltana|ilta|evening|essive of ilta; tänä iltana = tonight
ei|ei|not / doesn't|negative verb, 3rd person singular
ymmärrä|ymmärtää|understand|negative form of ymmärtää
kuka|kuka|who|
kirjoittaa|kirjoittaa|writes|3rd person singular of kirjoittaa
näin|näin|like this|
sitten|sitten|then|
joku|joku|someone|
koputtaa|koputtaa|knocks|3rd person singular of koputtaa
oveen|ovi|on the door (lit. "into the door")|illative of ovi
`;

const TEXT: [string, string][][] = [
  [
    ["Aino asuu Helsingissä.", "Aino lives in Helsinki."],
    ["Hän on kaksikymmentäviisi vuotta vanha.", "She is twenty-five years old."],
    ["Hänellä on pieni asunto ja musta kissa.", "She has a small apartment and a black cat."],
  ],
  [
    ["On maanantai-ilta.", "It is Monday evening."],
    ["Aino juo teetä ja lukee kirjaa.", "Aino is drinking tea and reading a book."],
    ["Kissa nukkuu sohvalla.", "The cat is sleeping on the sofa."],
  ],
  [
    ["Yhtäkkiä puhelin piippaa.", "Suddenly the phone beeps."],
    ["Aino katsoo puhelinta.", "Aino looks at the phone."],
    ["Numero on outo.", "The number is strange."],
    ["Hän avaa viestin.", "She opens the message."],
  ],
  [
    ["Viestissä lukee: ”Älä avaa ovea tänä iltana.”", "The message says: “Don't open the door tonight.”"],
    ["Aino ei ymmärrä.", "Aino doesn't understand."],
    ["Kuka kirjoittaa näin?", "Who writes like this?"],
  ],
  [["Sitten joku koputtaa oveen.", "Then someone knocks on the door."]],
];

export function sampleSeries(): Series {
  const glossary: Record<string, GlossEntry> = {};
  for (const line of GLOSS.trim().split("\n")) {
    const [form, lemma, tr, note] = line.split("|");
    const name = note.startsWith("name");
    const entry: GlossEntry = { lemma, tr, note: name ? note.replace(/^name,?\s*/, "") : note };
    if (name) entry.name = true;
    glossary[form] = entry;
  }
  const chapter: Chapter = {
    id: "sample-1",
    title: "Outo viesti",
    titleTr: "A Strange Message",
    paragraphs: TEXT.map((p) => p.map(([fi, tr]) => ({ fi, tr }))),
    glossary,
    level: 1,
    lookedUp: [],
    peeked: [],
    finished: false,
  };
  return {
    id: "sample",
    title: "Älä avaa ovea",
    premise: "A quiet Monday evening in Helsinki, a message from an unknown number — and a knock at the door.",
    genre: "Mystery thriller",
    storySoFar:
      "Aino, 25, lives alone in a small Helsinki apartment with her black cat. On a Monday evening, while she drinks tea and reads, her phone beeps: a message from an unknown number saying \"Don't open the door tonight.\" She doesn't understand who would write that. Then someone knocks on her door. Open threads: who sent the message, who is at the door, and why Aino.",
    chapters: [chapter],
    createdAt: Date.now(),
    sample: true,
  };
}
