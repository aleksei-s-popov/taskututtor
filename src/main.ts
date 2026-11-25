import "./style.css";
import { cefr, finishChapter, knownCount, learningWords, MAX_LEVEL, MIN_LEVEL, type ChapterResult } from "./adapt";
import { friendlyError, generateChapter, lookupWord, type NewSeriesRequest } from "./ai";
import { sampleSeries } from "./sample";
import { activeKey, formKey, load, MODELS, OR_MODELS, save, tokenize, uid, type Chapter, type Feedback, type GlossEntry, type Series } from "./store";

type View =
  | { name: "onboard" }
  | { name: "library" }
  | { name: "new" }
  | { name: "words" }
  | { name: "settings" }
  | { name: "reader"; seriesId: string; idx: number };

const state = load();
let view: View = state.settings.onboarded ? { name: "library" } : { name: "onboard" };
let lastResult: { chapterId: string; result: ChapterResult } | null = null;

const app = document.getElementById("app")!;
const sheet = document.getElementById("sheet")!;
const overlay = document.getElementById("overlay")!;
const toastEl = document.getElementById("toast")!;

const GENRES = [
  "Mystery",
  "Thriller",
  "Nordic noir crime",
  "Romance",
  "Fantasy",
  "Science fiction",
  "Horror",
  "Adventure",
  "Comedy",
  "Historical drama",
  "Surprise me",
];

const LEVELS: [number, string, string][] = [
  [0.5, "Just starting", "I know a few words at most"],
  [1, "A1 · Beginner", "I can read very simple sentences"],
  [2, "A2 · Elementary", "I manage short everyday texts"],
  [3, "B1 · Intermediate", "I can follow simple stories with effort"],
  [4, "B2 · Upper intermediate", "I read news and easy books"],
  [5, "C1 · Advanced", "I read novels, I want polish"],
];

// ---------- helpers ----------

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function persist(): void {
  if (!save(state)) toast("Storage is full — delete an old series to keep saving progress.");
}

let toastTimer = 0;
function toast(msg: string): void {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove("show"), 4000);
}

function go(v: View): void {
  closeSheet();
  view = v;
  render();
  window.scrollTo(0, 0);
}

function currentSeries(): Series | undefined {
  return view.name === "reader" ? state.series.find((s) => s.id === (view as { seriesId: string }).seriesId) : undefined;
}

function currentChapter(): Chapter | undefined {
  return view.name === "reader" ? currentSeries()?.chapters[view.idx] : undefined;
}

function speak(text: string): void {
  if (!("speechSynthesis" in window)) return toast("This browser can't read text aloud.");
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "fi-FI";
  u.rate = 0.85;
  speechSynthesis.speak(u);
}

// ---------- views ----------

function render(): void {
  document.documentElement.style.setProperty("--read-size", state.settings.fontSize + "px");
  switch (view.name) {
    case "onboard":
      app.innerHTML = onboardView();
      break;
    case "library":
      app.innerHTML = libraryView();
      break;
    case "new":
      app.innerHTML = newSeriesView();
      break;
    case "words":
      app.innerHTML = wordsView();
      break;
    case "settings":
      app.innerHTML = settingsView();
      break;
    case "reader":
      app.innerHTML = readerView();
      break;
  }
}

function levelOptions(selected: number): string {
  return LEVELS.map(
    ([v, title, desc]) => `
    <label class="choice">
      <input type="radio" name="level" value="${v}" ${v === selected ? "checked" : ""}>
      <span><b>${title}</b><small>${desc}</small></span>
    </label>`,
  ).join("");
}

function langField(): string {
  return `
    <label class="field">Show translations in
      <input name="lang" list="langs" value="${esc(state.settings.lang)}" autocomplete="off">
      <datalist id="langs">
        ${["English", "Russian", "Swedish", "German", "French", "Spanish", "Ukrainian", "Estonian"].map((l) => `<option value="${l}">`).join("")}
      </datalist>
    </label>`;
}

function keyField(full: boolean): string {
  const s = state.settings;
  const or = s.provider === "openrouter";
  return `
    ${
      full
        ? `<label class="field">AI provider
      <select name="provider" data-rerender>
        <option value="openrouter" ${or ? "selected" : ""}>OpenRouter — any model, one key</option>
        <option value="anthropic" ${or ? "" : "selected"}>Anthropic — Claude directly</option>
      </select>
    </label>`
        : ""
    }
    ${
      or
        ? `<label class="field">OpenRouter API key
      <input name="orKey" type="password" placeholder="sk-or-…" value="${esc(s.orKey)}" autocomplete="off">
      <small>Stories are written with your own key from
        <a href="https://openrouter.ai/keys" target="_blank" rel="noopener">openrouter.ai/keys</a>.
        It is stored only on this device and sent only to OpenRouter.</small>
    </label>`
        : `<label class="field">Claude API key
      <input name="apiKey" type="password" placeholder="sk-ant-…" value="${esc(s.apiKey)}" autocomplete="off">
      <small>Your own key from
        <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noopener">platform.claude.com</a>.
        It is stored only on this device and sent only to Anthropic.</small>
    </label>`
    }
    ${
      !full
        ? ""
        : or
          ? `<label class="field">Story writer
      <input name="orModel" list="or-models" value="${esc(s.orModel)}" autocomplete="off" spellcheck="false">
      <datalist id="or-models">${OR_MODELS.map((m) => `<option value="${m.id}">${m.label}</option>`).join("")}</datalist>
      <small>Any model id from <a href="https://openrouter.ai/models" target="_blank" rel="noopener">openrouter.ai/models</a>. Default: ${OR_MODELS[0].id}.</small>
    </label>`
          : `<label class="field">Story writer
      <select name="model">${MODELS.map((m) => `<option value="${m.id}" ${m.id === s.model ? "selected" : ""}>${m.label}</option>`).join("")}</select>
    </label>`
    }`;
}

function onboardView(): string {
  return `
  <main class="page">
    <h1 class="brand">Taskututtor</h1>
    <p class="lead">Learn Finnish by reading stories you can't put down — written for exactly your level, and a little above it.</p>
    <form data-form="onboard">
      <h2>How much Finnish do you know?</h2>
      <p class="hint">A rough guess is fine. The app adjusts after every chapter.</p>
      <div class="choices">${levelOptions(1)}</div>
      ${langField()}
      <label class="field">What do you like to read? <span class="opt">optional</span>
        <input name="interests" placeholder="e.g. detective stories, space, cooking, dark humour">
      </label>
      ${keyField(false)}
      <p class="hint">No key yet? You can add it later in Settings and start with the free sample chapter.</p>
      <button class="btn primary" type="submit">Start reading</button>
    </form>
  </main>`;
}

function libraryView(): string {
  const learning = learningWords(state).length;
  const cards = state.series
    .map((s) => {
      const done = s.chapters.filter((c) => c.finished).length;
      const next = Math.min(done, s.chapters.length - 1);
      const allRead = done === s.chapters.length;
      return `
      <article class="card">
        <div class="card-top">
          <span class="tag">${esc(s.genre)}</span>
          <button class="icon" data-act="delete-series" data-id="${s.id}" aria-label="Delete series">✕</button>
        </div>
        <h3>${esc(s.title)}</h3>
        <p>${esc(s.premise)}</p>
        <div class="card-foot">
          <small>${done} of ${s.chapters.length} chapter${s.chapters.length === 1 ? "" : "s"} read</small>
          <button class="btn primary small" data-act="open" data-id="${s.id}" data-idx="${next}">
            ${done === 0 ? "Start" : allRead ? "Continue story" : "Continue"}
          </button>
        </div>
      </article>`;
    })
    .join("");

  return `
  <header class="top">
    <h1 class="brand small">Taskututtor</h1>
    <button class="icon" data-act="nav" data-to="settings" aria-label="Settings">⚙</button>
  </header>
  <main class="page">
    <section class="stats">
      <div><b>${cefr(state.settings.level)}</b><small>your level · ${state.settings.level.toFixed(2)}</small></div>
      <div><b>${knownCount(state)}</b><small>words known</small></div>
      <button data-act="nav" data-to="words"><b>${learning}</b><small>learning ›</small></button>
    </section>
    ${activeKey(state.settings) ? "" : `<p class="notice">Add your API key in <a href="#" data-act="nav" data-to="settings">Settings</a> to generate new stories. The sample below works without it.</p>`}
    <h2>Your series</h2>
    ${cards || `<p class="hint">Nothing here yet — start your first series.</p>`}
    <button class="btn primary wide" data-act="nav" data-to="new">＋ New series</button>
  </main>`;
}

function newSeriesView(): string {
  return `
  <header class="top">
    <button class="icon" data-act="nav" data-to="library" aria-label="Back">‹</button>
    <h1>New series</h1><span></span>
  </header>
  <main class="page">
    <form data-form="new">
      <h2>Pick a genre</h2>
      <div class="chips">
        ${GENRES.map((g, i) => `<label class="chip"><input type="radio" name="genre" value="${g}" ${i === 0 ? "checked" : ""}><span>${g}</span></label>`).join("")}
      </div>
      <label class="field">Your own idea <span class="opt">optional</span>
        <textarea name="idea" rows="3" placeholder="e.g. a lighthouse keeper in Lapland who finds a letter addressed to her dead brother"></textarea>
      </label>
      <p class="hint">Written at level ${cefr(state.settings.level)}, slightly above what you've shown you know.</p>
      <button class="btn primary wide" type="submit">Write chapter 1</button>
    </form>
  </main>`;
}

function wordsView(): string {
  const learning = learningWords(state);
  return `
  <header class="top">
    <button class="icon" data-act="nav" data-to="library" aria-label="Back">‹</button>
    <h1>Words</h1><span></span>
  </header>
  <main class="page">
    <p class="hint">${knownCount(state)} known · ${learning.length} learning. Words you look up come back in later chapters until you stop needing help with them.</p>
    ${
      learning.length
        ? `<ul class="words">${learning
            .map(
              ([lemma, w]) => `
          <li>
            <button class="icon" data-act="speak" data-text="${esc(lemma)}" aria-label="Listen">🔊</button>
            <span><b>${esc(lemma)}</b><small>${esc(w.tr)}</small></span>
            <button class="btn small" data-act="mark-known" data-lemma="${esc(lemma)}">I know it</button>
          </li>`,
            )
            .join("")}</ul>`
        : `<p class="hint">Tap any word while reading to see what it means. It will show up here.</p>`
    }
  </main>`;
}

function settingsView(): string {
  const s = state.settings;
  return `
  <header class="top">
    <button class="icon" data-act="nav" data-to="library" aria-label="Back">‹</button>
    <h1>Settings</h1><span></span>
  </header>
  <main class="page">
    <form data-form="settings">
      ${keyField(true)}
      ${langField()}
      <label class="field">Interests
        <input name="interests" value="${esc(s.interests)}" placeholder="e.g. detective stories, space, cooking">
      </label>
      <label class="field">Level: <output id="lvl">${cefr(s.level)} · ${s.level.toFixed(2)}</output>
        <input name="level" type="range" min="${MIN_LEVEL}" max="${MAX_LEVEL}" step="0.25" value="${s.level}">
        <small>Adjusts itself as you read. Move it only if the stories are far off.</small>
      </label>
      <label class="field">Text size: <output id="fs">${s.fontSize}px</output>
        <input name="fontSize" type="range" min="16" max="30" step="1" value="${s.fontSize}">
      </label>
      <button class="btn primary wide" type="submit">Save</button>
    </form>
    <h2>Your data</h2>
    <p class="hint">Everything is stored on this device only. Export a backup before clearing browser data or switching phones.</p>
    <div class="row">
      <button class="btn" data-act="export">Export backup</button>
      <label class="btn">Import backup<input type="file" accept="application/json" data-import hidden></label>
    </div>
  </main>`;
}

function sentenceHtml(ch: Chapter, pi: number, si: number): string {
  const s = ch.paragraphs[pi][si];
  const looked = new Set(ch.lookedUp);
  const words = tokenize(s.fi)
    .map((t) => {
      if (!t.word) return esc(t.text);
      const g = ch.glossary[formKey(t.text)];
      const cls = g && looked.has(g.lemma.toLowerCase()) ? "w looked" : "w";
      return `<span class="${cls}" data-act="word">${esc(t.text)}</span>`;
    })
    .join("");
  return `<span class="s" data-sid="${pi}.${si}">${words}</span> `;
}

function endHtml(series: Series, ch: Chapter, idx: number): string {
  if (!ch.finished) {
    return `
      <h3>How was this chapter?</h3>
      <p class="hint">Your answer and the words you looked up shape the next one.</p>
      <div class="feedback">
        <button class="btn" data-act="feedback" data-fb="easy">😌<br>Too easy</button>
        <button class="btn" data-act="feedback" data-fb="right">🙂<br>Just right</button>
        <button class="btn" data-act="feedback" data-fb="hard">😵<br>Too hard</button>
      </div>`;
  }
  const r = lastResult?.chapterId === ch.id ? lastResult.result : null;
  const d = ch.levelDelta ?? 0;
  const move = d > 0 ? "The next chapter will stretch you a bit more." : d < 0 ? "The next chapter will be a little gentler." : "The next chapter stays at this difficulty.";
  const hasNext = idx + 1 < series.chapters.length;
  return `
    ${
      r
        ? `<p class="result">You looked up <b>${r.lookedUp}</b> of ${r.uniqueWords} different words (${Math.round(r.lookupRate * 100)}%).
           ${r.newlyKnown ? `<b>${r.newlyKnown}</b> more word${r.newlyKnown === 1 ? "" : "s"} now count as known.` : ""}
           Level: <b>${cefr(state.settings.level)} · ${state.settings.level.toFixed(2)}</b>${d ? ` (${d > 0 ? "+" : ""}${d.toFixed(2)})` : ""}. ${move}</p>`
        : `<p class="hint">Chapter finished ✓</p>`
    }
    <button class="btn primary wide" data-act="next">${hasNext ? "Next chapter ›" : "Write the next chapter ›"}</button>`;
}

function readerView(): string {
  const series = currentSeries();
  const ch = currentChapter();
  if (!series || !ch || view.name !== "reader") return libraryView();
  const idx = view.idx;
  return `
  <header class="top">
    <button class="icon" data-act="nav" data-to="library" aria-label="Back">‹</button>
    <h1>${esc(series.title)}</h1>
    <span class="chapnav">
      <button class="icon" data-act="open" data-id="${series.id}" data-idx="${idx - 1}" ${idx === 0 ? "disabled" : ""} aria-label="Previous chapter">‹</button>
      <small>${idx + 1}/${series.chapters.length}</small>
      <button class="icon" data-act="open" data-id="${series.id}" data-idx="${idx + 1}" ${idx + 1 >= series.chapters.length ? "disabled" : ""} aria-label="Next chapter">›</button>
    </span>
  </header>
  <main class="page reader">
    <p class="kicker">Chapter ${idx + 1} · ${cefr(ch.level)}</p>
    <h2 class="chapter-title">${esc(ch.title)}</h2>
    <p class="hint">Tap a word for its meaning. Try to guess first.</p>
    <article class="text">
      ${ch.paragraphs.map((p, pi) => `<p>${p.map((_, si) => sentenceHtml(ch, pi, si)).join("")}</p>`).join("")}
    </article>
    <section class="end" id="end">${endHtml(series, ch, idx)}</section>
  </main>`;
}

// ---------- word sheet ----------

let sheetCtx: { wordEl: HTMLElement; word: string; sid: string; sentence: { fi: string; tr: string } } | null = null;

function closeSheet(): void {
  sheet.classList.remove("open");
  document.querySelector(".w.active")?.classList.remove("active");
  sheetCtx = null;
}

function recordLookup(ch: Chapter, g: GlossEntry): void {
  const lemma = g.lemma.toLowerCase();
  if (g.name || ch.finished || ch.lookedUp.includes(lemma)) return;
  ch.lookedUp.push(lemma);
  persist();
}

function sheetHtml(word: string, g: GlossEntry | null, status: string, showSentence: boolean): string {
  const ctx = sheetCtx!;
  return `
    <div class="sheet-head">
      <div>
        <b class="form">${esc(word)}</b>
        ${g && g.lemma.toLowerCase() !== word.toLowerCase() ? `<span class="lemma">← ${esc(g.lemma)}</span>` : ""}
      </div>
      <button class="icon" data-act="close-sheet" aria-label="Close">✕</button>
    </div>
    ${g ? `<p class="tr">${esc(g.tr)}</p>${g.note ? `<p class="note">${esc(g.note)}</p>` : ""}` : `<p class="note">${esc(status)}</p>`}
    ${showSentence ? `<p class="sent-tr">${esc(ctx.sentence.tr)}</p>` : ""}
    <div class="sheet-actions">
      <button class="btn small" data-act="speak" data-text="${esc(ctx.sentence.fi)}">🔊 Listen</button>
      ${showSentence ? "" : `<button class="btn small" data-act="peek">Translate sentence</button>`}
      ${g && !g.name ? `<button class="btn small" data-act="know">I know this word</button>` : ""}
    </div>`;
}

async function openWord(el: HTMLElement): Promise<void> {
  const ch = currentChapter();
  const sEl = el.closest<HTMLElement>(".s");
  if (!ch || !sEl) return;
  const sid = sEl.dataset.sid!;
  const [pi, si] = sid.split(".").map(Number);
  const word = el.textContent ?? "";
  const key = formKey(word);

  document.querySelector(".w.active")?.classList.remove("active");
  el.classList.add("active");
  sheetCtx = { wordEl: el, word, sid, sentence: ch.paragraphs[pi][si] };
  const ctx = sheetCtx;
  const peeked = ch.peeked.includes(sid);

  let g: GlossEntry | null = ch.glossary[key] ?? null;
  sheet.innerHTML = sheetHtml(word, g, activeKey(state.settings) ? "Looking up…" : "No translation saved for this word. Add an API key in Settings to look it up.", peeked);
  sheet.classList.add("open");

  if (!g && activeKey(state.settings)) {
    try {
      g = await lookupWord(state, word, ctx.sentence.fi);
      ch.glossary[key] = g;
      persist();
    } catch (e) {
      if (sheetCtx === ctx) sheet.innerHTML = sheetHtml(word, null, friendlyError(e), peeked);
      return;
    }
    if (sheetCtx !== ctx) return;
    sheet.innerHTML = sheetHtml(word, g, "", peeked);
  }
  if (g) {
    recordLookup(ch, g);
    if (!g.name) markLooked(ch, g.lemma);
  }
}

/** Underline every occurrence of a looked-up lemma in the open chapter. */
function markLooked(ch: Chapter, lemma: string): void {
  const looked = ch.lookedUp.includes(lemma.toLowerCase());
  document.querySelectorAll<HTMLElement>(".text .w").forEach((w) => {
    const g = ch.glossary[formKey(w.textContent ?? "")];
    if (g && g.lemma.toLowerCase() === lemma.toLowerCase()) w.classList.toggle("looked", looked);
  });
}

// ---------- generation ----------

async function writeChapter(series: Series | null, req: NewSeriesRequest | null): Promise<void> {
  if (!activeKey(state.settings)) {
    toast("Add your API key in Settings to generate stories.");
    return go({ name: "settings" });
  }
  overlay.innerHTML = `
    <div class="gen">
      <div class="spinner"></div>
      <h3>${series ? "Writing the next chapter…" : "Inventing your story…"}</h3>
      <p id="gen-status">Planning the plot for level ${cefr(state.settings.level)}</p>
      <p class="hint">This usually takes about a minute. Keep the app open.</p>
      <button class="btn" data-act="cancel-gen">Cancel</button>
    </div>`;
  overlay.classList.add("open");

  const gen = generateChapter(state, series, req, (chars) => {
    const el = document.getElementById("gen-status");
    if (el) el.textContent = `Writing… ${chars.toLocaleString()} characters`;
  });
  cancelGen = gen.cancel;

  try {
    const { chapter, payload } = await gen.promise;
    let target = series;
    if (target) {
      target.chapters.push(chapter);
      target.storySoFar = payload.story_so_far;
    } else {
      target = {
        id: uid(),
        title: payload.series_title,
        premise: payload.series_premise,
        genre: req?.genre ?? "Story",
        storySoFar: payload.story_so_far,
        chapters: [chapter],
        createdAt: Date.now(),
      };
      state.series.unshift(target);
    }
    persist();
    go({ name: "reader", seriesId: target.id, idx: target.chapters.length - 1 });
  } catch (e) {
    toast(friendlyError(e));
  } finally {
    cancelGen = null;
    overlay.classList.remove("open");
  }
}

let cancelGen: (() => void) | null = null;

// ---------- events ----------

document.addEventListener("click", (ev) => {
  const el = (ev.target as HTMLElement).closest<HTMLElement>("[data-act]");
  if (!el) {
    if (sheet.classList.contains("open") && !(ev.target as HTMLElement).closest("#sheet")) closeSheet();
    return;
  }
  const d = el.dataset;
  switch (d.act) {
    case "nav":
      ev.preventDefault();
      go({ name: d.to as "library" | "new" | "words" | "settings" });
      break;
    case "open":
      go({ name: "reader", seriesId: d.id!, idx: Number(d.idx) });
      break;
    case "delete-series": {
      const s = state.series.find((x) => x.id === d.id);
      if (s && confirm(`Delete "${s.title}" and its chapters? Your word knowledge is kept.`)) {
        state.series = state.series.filter((x) => x.id !== d.id);
        persist();
        render();
      }
      break;
    }
    case "word":
      void openWord(el);
      break;
    case "close-sheet":
      closeSheet();
      break;
    case "speak":
      speak(d.text ?? "");
      break;
    case "peek": {
      const ch = currentChapter();
      if (!ch || !sheetCtx) break;
      if (!ch.finished && !ch.peeked.includes(sheetCtx.sid)) {
        ch.peeked.push(sheetCtx.sid);
        persist();
      }
      sheet.innerHTML = sheetHtml(sheetCtx.word, ch.glossary[formKey(sheetCtx.word)] ?? null, "", true);
      break;
    }
    case "know": {
      const ch = currentChapter();
      const g = ch && sheetCtx ? ch.glossary[formKey(sheetCtx.word)] : null;
      if (!ch || !g) break;
      const lemma = g.lemma.toLowerCase();
      ch.lookedUp = ch.lookedUp.filter((l) => l !== lemma);
      const w = (state.words[lemma] ??= { tr: g.tr, seen: 0, lookups: 0, streak: 0, known: true, lastSeen: Date.now() });
      w.known = true;
      w.streak = Math.max(w.streak, 3);
      persist();
      markLooked(ch, lemma);
      closeSheet();
      break;
    }
    case "mark-known": {
      const w = state.words[d.lemma!];
      if (w) {
        w.known = true;
        w.streak = Math.max(w.streak, 3);
        persist();
        render();
      }
      break;
    }
    case "feedback": {
      const series = currentSeries();
      const ch = currentChapter();
      if (!series || !ch || view.name !== "reader") break;
      lastResult = { chapterId: ch.id, result: finishChapter(state, ch, d.fb as Feedback) };
      persist();
      document.getElementById("end")!.innerHTML = endHtml(series, ch, view.idx);
      break;
    }
    case "next": {
      const series = currentSeries();
      if (!series || view.name !== "reader") break;
      if (view.idx + 1 < series.chapters.length) go({ name: "reader", seriesId: series.id, idx: view.idx + 1 });
      else void writeChapter(series, null);
      break;
    }
    case "cancel-gen":
      cancelGen?.();
      break;
    case "export": {
      const blob = new Blob([JSON.stringify(state)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "taskututtor-backup.json";
      a.click();
      URL.revokeObjectURL(a.href);
      break;
    }
  }
});

document.addEventListener("submit", (ev) => {
  const form = ev.target as HTMLFormElement;
  ev.preventDefault();
  const f = new FormData(form);
  const s = state.settings;
  const text = (k: string) => String(f.get(k) ?? "").trim();

  if (form.dataset.form === "onboard" || form.dataset.form === "settings") {
    if (f.has("provider")) s.provider = text("provider") === "anthropic" ? "anthropic" : "openrouter";
    if (f.has("apiKey")) s.apiKey = text("apiKey");
    if (f.has("orKey")) s.orKey = text("orKey");
    s.lang = text("lang") || "English";
    s.interests = text("interests");
    // The slider snaps to 0.25 steps, so only take its value when the reader actually moved it.
    const slider = form.querySelector<HTMLInputElement>('input[type="range"][name="level"]');
    if (!slider || slider.dataset.dirty) s.level = Number(f.get("level")) || s.level;
    if (form.dataset.form === "settings") {
      if (f.has("model")) s.model = text("model") || s.model;
      if (f.has("orModel")) s.orModel = text("orModel") || OR_MODELS[0].id;
      s.fontSize = Number(f.get("fontSize")) || s.fontSize;
      toast("Saved");
    } else {
      s.onboarded = true;
      // The built-in sample is A1 and its translations are in English.
      if (s.level <= 2) state.series.push(sampleSeries());
    }
    persist();
    go({ name: "library" });
  } else if (form.dataset.form === "new") {
    void writeChapter(null, { genre: text("genre"), idea: text("idea") });
  }
});

document.addEventListener("input", (ev) => {
  const el = ev.target as HTMLInputElement;
  if (el.name === "level" && el.type === "range") el.dataset.dirty = "1";
  if (el.name === "level" && el.type === "range") document.getElementById("lvl")!.textContent = `${cefr(Number(el.value))} · ${Number(el.value).toFixed(2)}`;
  if (el.name === "fontSize") document.getElementById("fs")!.textContent = el.value + "px";
});

document.addEventListener("change", async (ev) => {
  const el = ev.target as HTMLInputElement;
  if (el.matches("[data-rerender]")) {
    // Switching provider swaps the key and model fields.
    state.settings.provider = el.value === "anthropic" ? "anthropic" : "openrouter";
    persist();
    render();
    return;
  }
  if (!el.matches("[data-import]") || !el.files?.[0]) return;
  try {
    const data = JSON.parse(await el.files[0].text());
    if (!data.settings || !Array.isArray(data.series)) throw new Error("bad file");
    if (!confirm("Replace everything on this device with the backup?")) return;
    Object.assign(state, { settings: { ...state.settings, ...data.settings }, series: data.series, words: data.words ?? {} });
    persist();
    go({ name: "library" });
    toast("Backup restored");
  } catch {
    toast("That file isn't a Taskututtor backup.");
  }
});

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => void navigator.serviceWorker.register("./sw.js"));
}

render();
