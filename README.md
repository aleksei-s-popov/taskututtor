# Taskututtor

Learn Finnish by reading. Taskututtor is an installable web app (PWA) that writes serialized,
hard-to-put-down stories in Finnish at your level — and a little above it.

- **Graded stories on demand** — pick a genre or give your own idea; each chapter ends on a hook.
- **Tap any word** for its meaning, dictionary form and a grammar hint; translate or listen to the whole sentence.
- **Adapts to you** — after each chapter the app looks at how many words you looked up, how many
  sentences you translated and whether you found it too easy or too hard, then moves your level.
- **Tracks what you know** — words you read three chapters in a row without help count as known;
  words you looked up are woven back into later chapters until they stick.

Stories are written by an AI model using **your own API key**. The default provider is
[OpenRouter](https://openrouter.ai/keys); the default models (`openai/gpt-6.1-terra` for stories,
`microsoft/mai-image-2.7-flash` for pictures) were picked by testing — see
[docs/model-evaluation.md](docs/model-evaluation.md) — and any OpenRouter model id works. The
Anthropic API can be used directly instead. The key, your stories and your progress are stored only
in your browser; the key is sent only to the provider you chose.

## Getting started

1. **Get a key.** Create an API key at <https://openrouter.ai/keys> and add a few dollars of credit.
   (Or use an Anthropic key from <https://platform.claude.com/settings/keys>.)
2. **Open the app** and answer the three setup questions: your rough level, the language you want
   translations in, and what you like to read. Paste your key. You can skip the key and try the
   built-in sample chapter first.
3. **Install it on Android:** in Chrome, menu (⋮) → **Add to Home screen** → **Install**. It then
   opens like a normal app, and chapters you already have can be read offline.

## How to use it

- **New story or familiar faces:** when you already have a series, **＋ New series** asks who the
  story is about — a completely new story (new cast, new setting, no reused names) or a new
  adventure with the characters of an earlier series, kept consistent with what happened there.
- **Start a series:** tap **＋ New series**, pick a genre, optionally describe your own idea, and tap
  **Write chapter 1**. Writing a chapter takes about a minute.
- **Read:** try to understand from context first. Tap a word when you're stuck — you'll see its
  meaning, dictionary form and a short grammar hint. From that panel you can also
  **Translate sentence**, **Listen** to the sentence, or tap **I know this word** if you tapped by accident.
  Words you looked up stay underlined.
- **Listen while you read:** tap **Listen sentence by sentence** above the text (or **Play from here**
  after tapping a word). The sentence being read is highlighted. By default the player stops after
  every sentence and waits for you — ▶ moves on, 🔁 repeats, ⏮ ⏭ step back and forward. You can
  switch to automatic pauses of 2, 4 or 8 seconds and change the speed. Tapping a word pauses it.
- **Finish a chapter:** at the end, say whether it was **Too easy**, **Just right** or **Too hard**.
  The app shows how many words you needed and how your level moved, then writes the next chapter
  to match.
- **Dictionary card:** under the quick translation, each tapped word shows a dictionary card for its
  base form — part of speech, meanings and example phrases — from [Wiktionary](https://en.wiktionary.org)
  (free, no key; text is CC BY-SA, definitions are in English). Cards are saved on the device, so
  words you've opened before work offline. If Wiktionary has no entry, you can have the AI write one.
- **Illustrations (optional):** turn on **Illustrate every new chapter** in Settings to get one
  picture per chapter. They stay consistent across a series: the story model writes a fixed "art
  bible" (style and each character's look) that goes into every image prompt, and an earlier picture
  from the series is attached as a visual reference. Tap **↻ Regenerate illustration** under a picture
  to get a new one, or **🎨 Illustrate this chapter** on chapters that have none. Pictures are made
  through OpenRouter (an OpenRouter key is needed even if stories come from Anthropic).
- **Words:** the *learning* tile on the home screen lists the words you looked up. They come back
  in later chapters; mark any you already know.
- **Settings (⚙):** change provider, key and model, translation language, interests, text size,
  or move the level slider if stories are far off. **Export backup** saves all your progress to a
  file — do this before clearing browser data or switching phones, since everything lives on the device.

Tips: aim to look up only a handful of words per chapter — if you're tapping every other word,
answer "Too hard". Be honest with the feedback buttons; they are the strongest signal the app gets.

## Two ways to run it

- **Personal-key mode (this repo's default build, and the public site):** no account, no server.
  You bring an OpenRouter or Anthropic key; everything stays on your device. Nothing syncs.
- **Account mode (optional):** readers sign in, their library and progress sync between devices,
  and chapters are written on a server in the background, so no key is needed in the app. It needs
  the small backend in [`server/`](server/README.md) (Cloudflare Workers + Clerk) and is switched on
  by building the app with `VITE_API_URL` and `VITE_CLERK_PUBLISHABLE_KEY`. Signed-out readers of
  such a build still get personal-key mode.

## Develop

```bash
npm install
npm run dev      # local dev server
npm run build    # type-check and build to dist/
npm test         # unit tests for the adaptation and story logic
```

The server has its own tests (`cd server && npm test`): they start a real local Worker against a
fake AI service. Both suites run in CI on every push, and the site is only deployed when the app's
tests pass.

## Deploy

`.github/workflows/deploy.yml` builds and publishes to GitHub Pages on every push.
Enable it once under **Settings → Pages → Source: GitHub Actions**.

## Preparing for the YKI test

With **I'm preparing for the YKI test** ticked (the default; change it in Settings), the app aims
at the YKI intermediate test (B1):

- every chapter works one everyday YKI topic into the plot — housing, health, work, authorities,
  shopping, travel and so on, in rotation — with the real vocabulary of that situation;
- chapters include short real-life texts of the kind used in YKI reading tasks (messages, emails,
  notices, ads, official letters);
- each chapter ends with three test-style multiple-choice comprehension questions in Finnish, and
  your score feeds into the difficulty adjustment;
- the home screen shows a **Road to YKI** bar: progress from beginner to B1;
- **Listen sentence by sentence** reads the text aloud at your pace for listening practice.

The app trains reading, vocabulary and listening. YKI also tests writing and speaking, which it
does not cover.

## How stories stay on track

Each series is written against a hidden plan made with chapter 1: what is really going on, how it
ends, and one planned event per chapter (9–12 chapters). Every chapter prompt carries that plan, a
one-line log of all earlier chapters and a canon of established facts, and must deliver its planned
event, resolve the previous hook and change the situation. The reader sees only "Chapter 3 of 11";
at the end you can start a new series or a sequel with the same characters. Series created before
plans existed get a rescue plan on their next chapter that wraps them up in 6–8 chapters.

## How adaptation works

Level is a number where 1.0 = A1, 2.0 = A2, 3.0 = B1, 4.0 = B2, 5.0 = C1. The target is the
comprehensible-input sweet spot: looking up roughly 2–8 % of the distinct words in a chapter.
Fewer lookups or "too easy" nudges the level up; more lookups, many translated sentences or
"too hard" nudges it down (`src/adapt.ts`). The level, your still-learning words and your last
feedback go into the prompt for the next chapter (`src/ai.ts`).

## License

[Apache License 2.0](LICENSE)
