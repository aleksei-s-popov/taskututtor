// Dictionary cards. Free source: English Wiktionary's REST API (no key, CORS-enabled,
// content CC BY-SA). Cards are cached on the device so repeat lookups work offline.

export interface DictSense {
  def: string;
  examples: { fi: string; tr: string }[];
}

export interface DictCard {
  lemma: string;
  /** "wiktionary" or "ai" */
  source: "wiktionary" | "ai";
  entries: { pos: string; senses: DictSense[] }[];
}

const CACHE_KEY = "taskututtor.dict.v1";
const CACHE_MAX = 250;

type Cache = Record<string, DictCard>;

function readCache(): Cache {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}") as Cache;
  } catch {
    return {};
  }
}

export function cachedCard(lemma: string): DictCard | undefined {
  return readCache()[lemma.toLowerCase()];
}

export function cacheCard(card: DictCard): void {
  const cache = readCache();
  const key = card.lemma.toLowerCase();
  delete cache[key];
  cache[key] = card; // re-insert so the newest is last
  const keys = Object.keys(cache);
  for (const k of keys.slice(0, Math.max(0, keys.length - CACHE_MAX))) delete cache[k];
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    localStorage.removeItem(CACHE_KEY); // out of space: the cache is expendable
  }
}

/** Wiktionary returns HTML fragments; keep only their text. */
function plain(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("style, script, .mw-ref, sup.reference").forEach((n) => n.remove());
  return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
}

interface WikiEntry {
  partOfSpeech?: string;
  definitions?: { definition?: string; parsedExamples?: { example?: string; translation?: string }[] }[];
}

async function fetchPage(title: string): Promise<WikiEntry[] | null> {
  const url = `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(title)}`;
  const headers = { Accept: "application/json", "Api-User-Agent": "Taskututtor/0.1 (Finnish reading app)" };
  let res = await fetch(url, { headers });
  if (res.status === 429) {
    // Rate limited: wait briefly and try once more.
    await new Promise((r) => setTimeout(r, 1200));
    res = await fetch(url, { headers });
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(res.status === 429 ? "Wiktionary is busy — try again in a moment." : "Couldn't reach Wiktionary.");
  const json = (await res.json()) as Record<string, WikiEntry[]>;
  return json.fi ?? null;
}

/** Looks a dictionary form up in Wiktionary. Returns null when there is no Finnish entry. */
export async function wiktionaryCard(lemma: string): Promise<DictCard | null> {
  const title = lemma.trim();
  // Page titles are case-sensitive: common words are lowercase, names capitalised.
  let raw = await fetchPage(title);
  if (!raw && title !== title.toLowerCase()) raw = await fetchPage(title.toLowerCase());
  if (!raw) return null;

  const entries = raw
    .map((e) => ({
      pos: e.partOfSpeech ?? "",
      senses: (e.definitions ?? [])
        .map((d) => ({
          def: plain(d.definition ?? ""),
          examples: (d.parsedExamples ?? [])
            .map((x) => ({ fi: plain(x.example ?? ""), tr: plain(x.translation ?? "") }))
            .filter((x) => x.fi),
        }))
        .filter((s) => s.def),
    }))
    .filter((e) => e.senses.length);
  return entries.length ? { lemma: title, source: "wiktionary", entries } : null;
}
