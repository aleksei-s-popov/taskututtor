import "@fontsource-variable/literata";
import "@fontsource-variable/literata/wght-italic.css";
import "./style.css";
import { icon } from "./icons";
import { cefr, finishChapter, ykiProgress, knownCount, learningWords, MAX_LEVEL, MIN_LEVEL, type ChapterResult } from "./adapt";
import { aiDictionaryCard, friendlyError, generateChapter, generateIllustration, lookupWord, type NewSeriesRequest } from "./ai";
import { cacheCard, cachedCard, wiktionaryCard, type DictCard } from "./dict";
import { compress, deleteImage, getImage, putImage } from "./images";
import { sampleSeries } from "./sample";
import { activeKey, arcLength, formKey, seriesNames, IMAGE_MODELS, load, MODELS, OR_MODELS, save, tokenize, uid, type Chapter, type Feedback, type GlossEntry, type Series } from "./store";

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
  playerClose();
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
    case "reader": {
      app.innerHTML = readerView();
      const ch = currentChapter();
      if (ch) void loadArt(ch);
      break;
    }
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
      <input name="orKey" class="secret" type="text" inputmode="text" placeholder="sk-or-…" value="${esc(s.orKey)}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
      <small>Stories are written with your own key from
        <a href="https://openrouter.ai/keys" target="_blank" rel="noopener">openrouter.ai/keys</a>.
        It is stored only on this device and sent only to OpenRouter.</small>
    </label>`
        : `<label class="field">Claude API key
      <input name="apiKey" class="secret" type="text" inputmode="text" placeholder="sk-ant-…" value="${esc(s.apiKey)}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
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
<label class="check">
        <input type="checkbox" name="yki" ${state.settings.yki ? "checked" : ""}>
        <span><b>I'm preparing for the YKI test</b><small>Stories work in everyday YKI themes and text types, and each chapter ends with test-style comprehension questions.</small></span>
      </label>
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
          <span class="tag">${s.sample ? "Sample · " : ""}${esc(s.genre)}</span>
          <button class="icon" data-act="delete-series" data-id="${s.id}" aria-label="Delete series">${icon("trash", 18)}</button>
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
    <button class="icon" data-act="nav" data-to="settings" aria-label="Settings">${icon("settings", 22)}</button>
  </header>
  <main class="page">
    <section class="stats">
      <div><b>${cefr(state.settings.level)}</b><small>your level · ${state.settings.level.toFixed(2)}</small></div>
      <div><b>${knownCount(state)}</b><small>words known</small></div>
      <button data-act="nav" data-to="words"><b>${learning}</b><small>learning ${icon("forward", 12)}</small></button>
    </section>
    ${
      state.settings.yki
        ? `<section class="goal">
        <div class="goal-top"><b>Road to YKI</b><small>intermediate test · B1</small><span>${Math.round(ykiProgress(state.settings.level) * 100)}%</span></div>
        <div class="bar"><i style="width:${Math.max(2, Math.round(ykiProgress(state.settings.level) * 100))}%"></i></div>
      </section>`
        : ""
    }
    ${activeKey(state.settings) ? "" : `<p class="notice">Add your API key in <a href="#" data-act="nav" data-to="settings">Settings</a> to generate new stories. The sample below works without it.</p>`}
    <h2>Your series</h2>
    ${cards || `<p class="hint">Nothing here yet — start your first series.</p>`}
    <button class="btn primary wide" data-act="nav" data-to="new">${icon("plus")} New series</button>
  </main>`;
}

function newSeriesView(): string {
  return `
  <header class="top">
    <button class="icon" data-act="nav" data-to="library" aria-label="Back">${icon("back", 22)}</button>
    <h1>New series</h1><span></span>
  </header>
  <main class="page">
    <form data-form="new">
      ${
        state.series.length
          ? `<h2>Who is it about?</h2>
      <div class="choices">
        <label class="choice">
          <input type="radio" name="from" value="" checked>
          <span><b>A completely new story</b><small>New characters, new world</small></span>
        </label>
        ${state.series
          .map(
            (s) => `<label class="choice">
          <input type="radio" name="from" value="${s.id}">
          <span><b>Characters from “${esc(s.title)}”</b><small>${esc(seriesNames(s).slice(0, 4).join(", ") || s.premise)} — a new adventure, consistent with that story</small></span>
        </label>`,
          )
          .join("")}
      </div>`
          : ""
      }
      <h2>Pick a genre</h2>
      <div class="chips">
        ${GENRES.map((g, i) => `<label class="chip"><input type="radio" name="genre" value="${g}" ${i === 0 ? "checked" : ""}><span>${g}</span></label>`).join("")}
      </div>
      <label class="field">Your own idea <span class="opt">optional</span>
        <textarea name="idea" rows="3" placeholder="e.g. a lighthouse keeper in Lapland who finds a letter addressed to her dead brother — or, for returning characters, who to follow and what should happen"></textarea>
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
    <button class="icon" data-act="nav" data-to="library" aria-label="Back">${icon("back", 22)}</button>
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
            <button class="icon" data-act="speak" data-text="${esc(lemma)}" aria-label="Listen">${icon("volume")}</button>
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
    <button class="icon" data-act="nav" data-to="library" aria-label="Back">${icon("back", 22)}</button>
    <h1>Settings</h1><span></span>
  </header>
  <main class="page">
    <form data-form="settings">
      ${keyField(true)}
      ${langField()}
<label class="check">
        <input type="checkbox" name="yki" ${state.settings.yki ? "checked" : ""}>
        <span><b>I'm preparing for the YKI test</b><small>Stories work in everyday YKI themes and text types, and each chapter ends with test-style comprehension questions.</small></span>
      </label>
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
      <h2>Illustrations</h2>
      <label class="check">
        <input type="checkbox" name="illustrations" ${s.illustrations ? "checked" : ""}>
        <span><b>Illustrate every new chapter</b><small>One picture per chapter, in a consistent style with the same characters. Costs a few cents each.</small></span>
      </label>
      ${
        s.provider === "anthropic"
          ? `<label class="field">OpenRouter API key <span class="opt">for illustrations</span>
        <input name="orKey" class="secret" type="text" placeholder="sk-or-…" value="${esc(s.orKey)}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
        <small>Pictures are painted through <a href="https://openrouter.ai/keys" target="_blank" rel="noopener">OpenRouter</a>, even when stories come from Anthropic.</small>
      </label>`
          : ""
      }
      <label class="field">Illustrator
        <input name="imageModel" list="image-models" value="${esc(s.imageModel)}" autocomplete="off" spellcheck="false">
        <datalist id="image-models">${IMAGE_MODELS.map((m) => `<option value="${m.id}">${m.label}</option>`).join("")}</datalist>
      </label>
      <button class="btn primary wide" type="submit">Save</button>
    </form>
    <h2>Your data</h2>
    <p class="hint">Everything is stored on this device only. Export a backup before clearing browser data or switching phones (illustrations are not included — they can be regenerated).</p>
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

function quizHtml(ch: Chapter): string {
  const qs = ch.questions ?? [];
  if (!qs.length) return "";
  return `
    <h3>Did you understand?</h3>
    <p class="hint">Three questions like the ones in the YKI reading test.</p>
    ${qs
      .map((q, qi) => {
        const picked = ch.answers?.[qi];
        const done = picked !== undefined && picked !== null;
        return `<div class="q">
          <p class="q-text" lang="fi">${qi + 1}. ${esc(q.q)}</p>
          ${q.options
            .map((o, oi) => {
              const cls = !done ? "" : oi === q.answer ? "correct" : oi === picked ? "wrong" : "";
              return `<button class="opt-btn ${cls}" lang="fi" data-act="answer" data-q="${qi}" data-o="${oi}" ${done || ch.finished ? "disabled" : ""}>${esc(o)}</button>`;
            })
            .join("")}
          ${q.tr ? `<details><summary>Translation</summary><p class="note">${esc(q.tr)}</p></details>` : ""}
        </div>`;
      })
      .join("")}`;
}

function endHtml(series: Series, ch: Chapter, idx: number): string {
  if (!ch.finished) {
    return `
      ${quizHtml(ch)}
      <h3>How was this chapter?</h3>
      <p class="hint">Your answer and the words you looked up shape the next one.</p>
      <div class="feedback">
        <button class="btn" data-act="feedback" data-fb="easy">Too easy</button>
        <button class="btn" data-act="feedback" data-fb="right">Just right</button>
        <button class="btn" data-act="feedback" data-fb="hard">Too hard</button>
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
           ${r.quiz.total ? `Questions: <b>${r.quiz.right}/${r.quiz.total}</b> right.` : ""}
           ${r.newlyKnown ? `<b>${r.newlyKnown}</b> more word${r.newlyKnown === 1 ? "" : "s"} now count as known.` : ""}
           Level: <b>${cefr(state.settings.level)} · ${state.settings.level.toFixed(2)}</b>${d ? ` (${d > 0 ? "+" : ""}${d.toFixed(2)})` : ""}. ${move}</p>`
        : `<p class="hint done">${icon("check", 16)} Chapter finished</p>`
    }
    ${
      !hasNext && series.plan && series.chapters.length >= arcLength(series)
        ? `<h3>The end</h3>
           <p class="hint">This story has reached its ending. Start something new, or follow the same characters into a new adventure.</p>
           <button class="btn primary wide" data-act="nav" data-to="new">${icon("plus")} New series</button>
           <button class="btn wide" data-act="next">Write a sequel ${icon("forward", 18)}</button>`
        : `<button class="btn primary wide" data-act="next">${hasNext ? "Next chapter" : "Write the next chapter"} ${icon("forward", 18)}</button>`
    }`;
}

function readerView(): string {
  const series = currentSeries();
  const ch = currentChapter();
  if (!series || !ch || view.name !== "reader") return libraryView();
  const idx = view.idx;
  return `
  <header class="top">
    <button class="icon" data-act="nav" data-to="library" aria-label="Back">${icon("back", 22)}</button>
    <h1>${esc(series.title)}</h1>
    <span class="chapnav">
      <button class="icon" data-act="open" data-id="${series.id}" data-idx="${idx - 1}" ${idx === 0 ? "disabled" : ""} aria-label="Previous chapter">${icon("back", 18)}</button>
      <small>${idx + 1}/${series.chapters.length}</small>
      <button class="icon" data-act="open" data-id="${series.id}" data-idx="${idx + 1}" ${idx + 1 >= series.chapters.length ? "disabled" : ""} aria-label="Next chapter">${icon("forward", 18)}</button>
    </span>
  </header>
  <main class="page reader">
    <p class="kicker">Chapter ${idx + 1}${series.plan && idx >= series.plan.start && idx < arcLength(series) ? ` of ${arcLength(series)}` : ""} · ${cefr(ch.level)}</p>
    <h2 class="chapter-title">${esc(ch.title)}</h2>
    <figure class="art" id="art">${artHtml(ch)}</figure>
    <div class="reader-tools">
      <button class="btn small" data-act="player-open">${icon("volume", 18)} Listen sentence by sentence</button>
    </div>
    <p class="hint">Tap a word for its meaning. Try to guess first.</p>
    <article class="text">
      ${ch.paragraphs.map((p, pi) => `<p>${p.map((_, si) => sentenceHtml(ch, pi, si)).join("")}</p>`).join("")}
    </article>
    <section class="end" id="end">${endHtml(series, ch, idx)}</section>
  </main>`;
}

// ---------- sentence-by-sentence listening ----------

const player = document.getElementById("player")! as HTMLElement & {
  active?: boolean;
  idx: number;
  playing?: boolean;
  /** the current sentence has been read out in full */
  done?: boolean;
  timer?: number;
  /** bumped on every action so callbacks of cancelled speech are ignored */
  run: number;
};
player.idx = 0;
player.run = 0;

const GAPS = [0, 2, 4, 8];
const RATES = [0.7, 0.85, 1];

/** Sentence ids ("paragraph.sentence") of a chapter in reading order. */
function playerOrder(ch: Chapter): string[] {
  return ch.paragraphs.flatMap((p, pi) => p.map((_, si) => `${pi}.${si}`));
}

function renderPlayer(): void {
  const ch = currentChapter();
  if (!player.active || !ch) {
    player.classList.remove("open");
    return;
  }
  const total = playerOrder(ch).length;
  const gap = state.settings.listenGap;
  player.innerHTML = `
    <div class="player-main">
      <button class="icon" data-act="player-prev" aria-label="Previous sentence" ${player.idx === 0 ? "disabled" : ""}>${icon("prev", 24)}</button>
      <button class="icon" data-act="player-repeat" aria-label="Repeat sentence">${icon("repeat", 22)}</button>
      <button class="icon play" data-act="player-toggle" aria-label="${player.playing ? "Pause" : "Play"}">${icon(player.playing ? "pause" : "play", 26)}</button>
      <button class="icon" data-act="player-next" aria-label="Next sentence" ${player.idx >= total - 1 ? "disabled" : ""}>${icon("next", 24)}</button>
      <button class="icon" data-act="player-close" aria-label="Close player">${icon("close", 22)}</button>
    </div>
    <div class="player-opts">
      <small>${player.idx + 1} / ${total}</small>
      <button class="btn small" data-act="player-gap">${gap ? `Pause ${gap} s` : "Wait for me"}</button>
      <button class="btn small" data-act="player-rate">Speed ${state.settings.listenRate}×</button>
    </div>`;
  player.classList.add("open");
}

function playerMark(ch: Chapter): void {
  document.querySelector(".s.speaking")?.classList.remove("speaking");
  const el = document.querySelector<HTMLElement>(`.s[data-sid="${playerOrder(ch)[player.idx]}"]`);
  if (!el) return;
  el.classList.add("speaking");
  el.scrollIntoView({ block: "center", behavior: "smooth" });
}

/** Reads sentence `idx` aloud, then waits (for a tap, or the chosen pause) before the next one. */
function playerPlay(idx: number): void {
  const ch = currentChapter();
  if (!ch) return;
  const order = playerOrder(ch);
  clearTimeout(player.timer);
  speechSynthesis.cancel();
  const run = ++player.run;
  if (idx >= order.length) {
    // End of the chapter: keep the bar, stop on the last sentence.
    player.playing = false;
    player.done = true;
    renderPlayer();
    return;
  }
  player.active = true;
  player.idx = Math.max(0, idx);
  player.playing = true;
  player.done = false;
  const [pi, si] = order[player.idx].split(".").map(Number);
  const u = new SpeechSynthesisUtterance(ch.paragraphs[pi][si].fi);
  u.lang = "fi-FI";
  u.rate = state.settings.listenRate;
  u.onend = () => {
    if (run !== player.run) return;
    player.done = true;
    const gap = state.settings.listenGap;
    if (gap && player.idx < order.length - 1) {
      player.timer = window.setTimeout(() => run === player.run && playerPlay(player.idx + 1), gap * 1000);
    } else {
      player.playing = false;
      renderPlayer();
    }
  };
  u.onerror = () => {
    if (run !== player.run) return;
    player.playing = false;
    renderPlayer();
  };
  playerMark(ch);
  renderPlayer();
  speechSynthesis.speak(u);
}

function playerPause(): void {
  clearTimeout(player.timer);
  player.run++;
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  player.playing = false;
  renderPlayer();
}

function playerClose(): void {
  clearTimeout(player.timer);
  player.run++;
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  player.active = false;
  player.playing = false;
  player.idx = 0;
  document.querySelector(".s.speaking")?.classList.remove("speaking");
  renderPlayer();
}

// ---------- illustrations ----------

/** chapter id → data URL, for chapters opened in this session */
const artCache = new Map<string, string>();
const painting = new Set<string>();

function artHtml(ch: Chapter): string {
  const url = artCache.get(ch.id);
  if (painting.has(ch.id)) {
    return `${url ? `<img src="${url}" alt="" class="dim">` : ""}<div class="art-wait"><div class="spinner small"></div><span>Painting the illustration…</span></div>`;
  }
  if (url) {
    return `<img src="${url}" alt="Illustration for this chapter">
      <button class="btn small ghost" data-act="illustrate">${icon("repeat", 16)} Regenerate illustration</button>`;
  }
  if (ch.hasImage) return `<div class="art-wait"></div>`; // still loading from storage
  if (!state.settings.illustrations) return "";
  return `<button class="btn small" data-act="illustrate">${icon("image", 18)} Illustrate this chapter</button>`;
}

function refreshArt(ch: Chapter): void {
  const el = document.getElementById("art");
  if (el && currentChapter()?.id === ch.id) el.innerHTML = artHtml(ch);
}

/** Loads the stored picture for the open chapter, if it has one. */
async function loadArt(ch: Chapter): Promise<void> {
  if (!ch.hasImage || artCache.has(ch.id)) return;
  const url = await getImage(ch.id);
  if (url) artCache.set(ch.id, url);
  else ch.hasImage = false; // storage was cleared
  refreshArt(ch);
}

async function illustrate(series: Series, ch: Chapter): Promise<void> {
  if (painting.has(ch.id)) return;
  if (!state.settings.orKey) {
    toast("Illustrations need an OpenRouter key — add one in Settings.");
    return;
  }
  painting.add(ch.id);
  refreshArt(ch);
  try {
    // Reference picture: the earliest other illustrated chapter of the series anchors the look.
    // A story that reuses another series' characters borrows that series' pictures as its anchor.
    const parent = state.series.find((x) => x.id === series.basedOn);
    const anchor = series.chapters.find((c) => c.id !== ch.id && c.hasImage) ?? parent?.chapters.find((c) => c.hasImage);
    const reference = anchor ? (artCache.get(anchor.id) ?? (await getImage(anchor.id))) : undefined;
    const url = await compress(await generateIllustration(state, series, ch, reference));
    await putImage(ch.id, url);
    artCache.set(ch.id, url);
    ch.hasImage = true;
    persist();
  } catch (e) {
    toast(friendlyError(e));
  } finally {
    painting.delete(ch.id);
    refreshArt(ch);
  }
}

// ---------- word sheet ----------

interface DictState {
  lemma: string;
  status: "loading" | "ok" | "none" | "error";
  card?: DictCard;
  message?: string;
  /** show every meaning and example instead of the short version */
  all: boolean;
}

let sheetCtx: { wordEl: HTMLElement; word: string; sid: string; sentence: { fi: string; tr: string }; dict?: DictState } | null = null;

function dictHtml(): string {
  const d = sheetCtx?.dict;
  if (!d) return "";
  if (d.status === "loading") return `<p class="note">Opening the dictionary…</p>`;
  if (d.status === "error") return `<p class="note">${esc(d.message ?? "")}</p>`;
  if (d.status === "none" || !d.card) {
    return `<p class="note">No dictionary entry found for “${esc(d.lemma)}”.
      ${activeKey(state.settings) ? `<button class="link" data-act="dict-ai">Write one with AI</button>` : ""}</p>`;
  }
  const card = d.card;
  const total = card.entries.reduce((n, e) => n + e.senses.length, 0);
  let budget = d.all ? Infinity : 3;
  const body = card.entries
    .map((e) => {
      const senses = e.senses.slice(0, budget);
      budget -= senses.length;
      if (!senses.length) return "";
      return `
        <p class="pos">${esc(e.pos)}</p>
        <ol>${senses
          .map(
            (s) => `<li>${esc(s.def)}${s.examples
              .slice(0, d.all ? 4 : 1)
              .map((x) => `<span class="ex"><i lang="fi">${esc(x.fi)}</i>${x.tr ? ` — ${esc(x.tr)}` : ""}</span>`)
              .join("")}</li>`,
          )
          .join("")}</ol>`;
    })
    .join("");
  const more = total > 3 || card.entries.some((e) => e.senses.some((s) => s.examples.length > 1));
  return `
    <section class="dict">
      <p class="dict-head"><b lang="fi">${esc(card.lemma)}</b>
        <button class="icon" data-act="speak" data-text="${esc(card.lemma)}" aria-label="Listen to the word">${icon("volume", 18)}</button></p>
      ${body}
      <p class="dict-foot">
        ${more ? `<button class="link" data-act="dict-all">${d.all ? "Show less" : total > 3 ? `Show all ${total} meanings and examples` : "Show all examples"}</button>` : ""}
        ${
          card.source === "wiktionary"
            ? `<a href="https://en.wiktionary.org/wiki/${encodeURIComponent(card.lemma)}#Finnish" target="_blank" rel="noopener">Wiktionary</a>`
            : `<span>written by AI</span>`
        }
      </p>
    </section>`;
}

function refreshDict(): void {
  const el = document.getElementById("dict");
  if (el) el.innerHTML = dictHtml();
}

/** Fills the open sheet's dictionary card: device cache first, then Wiktionary. */
async function loadDict(lemma: string): Promise<void> {
  const ctx = sheetCtx;
  if (!ctx) return;
  const cached = cachedCard(lemma);
  ctx.dict = cached ? { lemma, status: "ok", card: cached, all: false } : { lemma, status: "loading", all: false };
  refreshDict();
  if (cached) return;
  try {
    const card = await wiktionaryCard(lemma);
    if (card) cacheCard(card);
    ctx.dict = card ? { lemma, status: "ok", card, all: false } : { lemma, status: "none", all: false };
  } catch (e) {
    ctx.dict = { lemma, status: "error", message: navigator.onLine ? friendlyError(e) : "The dictionary needs an internet connection.", all: false };
  }
  if (sheetCtx === ctx) refreshDict();
}

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
      <button class="icon" data-act="close-sheet" aria-label="Close">${icon("close")}</button>
    </div>
    ${g ? `<p class="tr">${esc(g.tr)}</p>${g.note ? `<p class="note">${esc(g.note)}</p>` : ""}` : `<p class="note">${esc(status)}</p>`}
    ${showSentence ? `<p class="sent-tr">${esc(ctx.sentence.tr)}</p>` : ""}
    <div id="dict">${dictHtml()}</div>
    <div class="sheet-actions">
      <button class="btn small" data-act="speak" data-text="${esc(ctx.sentence.fi)}">${icon("volume", 18)} Listen</button>
      <button class="btn small" data-act="player-open">${icon("play", 16)} Play from here</button>
      ${showSentence ? "" : `<button class="btn small" data-act="peek">Translate sentence</button>`}
      ${g && !g.name ? `<button class="btn small" data-act="know">I know this word</button>` : ""}
    </div>`;
}

async function openWord(el: HTMLElement): Promise<void> {
  if (player.playing) playerPause(); // give the reader time to look the word up
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
    if (!g.name) {
      markLooked(ch, g.lemma);
      void loadDict(g.lemma);
    }
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
      if (payload.art_bible) target.artBible = payload.art_bible;
      // A new plan is only accepted when one was asked for: no plan yet, or the arc is over.
      const beats = (payload.plan?.beats ?? []).filter((b) => b.trim());
      if (beats.length && (!target.plan || target.chapters.length > arcLength(target))) {
        target.plan = { truth: payload.plan.truth, ending: payload.plan.ending, beats, start: target.chapters.length - 1 };
      }
    } else {
      target = {
        id: uid(),
        title: payload.series_title,
        premise: payload.series_premise,
        genre: req?.genre ?? "Story",
        basedOn: req?.from?.id,
        storySoFar: payload.story_so_far,
        artBible: payload.art_bible || undefined,
        plan: payload.plan?.beats?.length ? { truth: payload.plan.truth, ending: payload.plan.ending, beats: payload.plan.beats, start: 0 } : undefined,
        chapters: [chapter],
        createdAt: Date.now(),
      };
      state.series.unshift(target);
    }
    persist();
    go({ name: "reader", seriesId: target.id, idx: target.chapters.length - 1 });
    if (state.settings.illustrations && state.settings.orKey) void illustrate(target, chapter);
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
        for (const c of s.chapters) {
          artCache.delete(c.id);
          if (c.hasImage) void deleteImage(c.id);
        }
        state.series = state.series.filter((x) => x.id !== d.id);
        persist();
        render();
      }
      break;
    }
    case "illustrate": {
      const series = currentSeries();
      const ch = currentChapter();
      if (series && ch) void illustrate(series, ch);
      break;
    }
    case "word":
      void openWord(el);
      break;
    case "close-sheet":
      closeSheet();
      break;
    case "answer": {
      const series = currentSeries();
      const ch = currentChapter();
      if (!series || !ch || ch.finished || view.name !== "reader") break;
      (ch.answers ??= [])[Number(d.q)] = Number(d.o);
      persist();
      document.getElementById("end")!.innerHTML = endHtml(series, ch, view.idx);
      break;
    }
    case "player-open": {
      const ch = currentChapter();
      if (!ch) break;
      if (!("speechSynthesis" in window)) {
        toast("This browser can't read text aloud.");
        break;
      }
      // Start from the sentence of the open word, if there is one.
      const from = sheetCtx ? playerOrder(ch).indexOf(sheetCtx.sid) : -1;
      closeSheet();
      playerPlay(from >= 0 ? from : player.active ? player.idx : 0);
      break;
    }
    case "player-toggle":
      if (player.playing) playerPause();
      else playerPlay(player.done ? player.idx + 1 : player.idx);
      break;
    case "player-prev":
      playerPlay(player.idx - 1);
      break;
    case "player-next":
      playerPlay(player.idx + 1);
      break;
    case "player-repeat":
      playerPlay(player.idx);
      break;
    case "player-gap": {
      const i = GAPS.indexOf(state.settings.listenGap);
      state.settings.listenGap = GAPS[(i + 1) % GAPS.length];
      persist();
      renderPlayer();
      break;
    }
    case "player-rate": {
      const i = RATES.indexOf(state.settings.listenRate);
      state.settings.listenRate = RATES[(i + 1) % RATES.length];
      persist();
      renderPlayer();
      break;
    }
    case "player-close":
      playerClose();
      break;
    case "speak":
      speak(d.text ?? "");
      break;
    case "dict-all":
      if (sheetCtx?.dict) {
        sheetCtx.dict.all = !sheetCtx.dict.all;
        refreshDict();
      }
      break;
    case "dict-ai": {
      const ctx = sheetCtx;
      if (!ctx?.dict) break;
      const lemma = ctx.dict.lemma;
      ctx.dict = { lemma, status: "loading", all: false };
      refreshDict();
      aiDictionaryCard(state, lemma)
        .then((card) => {
          cacheCard(card);
          ctx.dict = { lemma, status: "ok", card, all: false };
        })
        .catch((e) => {
          ctx.dict = { lemma, status: "error", message: friendlyError(e), all: false };
        })
        .finally(() => {
          if (sheetCtx === ctx) refreshDict();
        });
      break;
    }
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
    // Keys must not contain whitespace (easy to pick up when pasting on a phone).
    const key = (k: string) => text(k).replace(/\s+/g, "");
    if (f.has("apiKey")) s.apiKey = key("apiKey");
    if (f.has("orKey")) s.orKey = key("orKey");
    // A key pasted into the wrong provider's field: move it and switch provider.
    let switched = "";
    if (s.provider === "openrouter" && s.orKey.startsWith("sk-ant-")) {
      s.apiKey = s.orKey;
      s.orKey = "";
      s.provider = "anthropic";
      switched = "That is an Anthropic key — switched the provider to Anthropic.";
    } else if (s.provider === "anthropic" && s.apiKey.startsWith("sk-or-")) {
      s.orKey = s.apiKey;
      s.apiKey = "";
      s.provider = "openrouter";
      switched = "That is an OpenRouter key — switched the provider to OpenRouter.";
    }
    s.lang = text("lang") || "English";
    s.interests = text("interests");
    s.yki = f.has("yki");
    // The slider snaps to 0.25 steps, so only take its value when the reader actually moved it.
    const slider = form.querySelector<HTMLInputElement>('input[type="range"][name="level"]');
    if (!slider || slider.dataset.dirty) s.level = Number(f.get("level")) || s.level;
    if (form.dataset.form === "settings") {
      if (f.has("model")) s.model = text("model") || s.model;
      if (f.has("orModel")) s.orModel = text("orModel") || OR_MODELS[0].id;
      s.fontSize = Number(f.get("fontSize")) || s.fontSize;
      s.illustrations = f.has("illustrations");
      s.imageModel = text("imageModel") || IMAGE_MODELS[0].id;
      if (s.illustrations && !s.orKey) switched = "Illustrations need an OpenRouter key — add one above.";
      toast(switched || "Saved");
    } else {
      s.onboarded = true;
      // The built-in sample is A1 and its translations are in English.
      if (s.level <= 2) state.series.push(sampleSeries());
    }
    persist();
    go({ name: "library" });
  } else if (form.dataset.form === "new") {
    void writeChapter(null, { genre: text("genre"), idea: text("idea"), from: state.series.find((x) => x.id === text("from")) });
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
