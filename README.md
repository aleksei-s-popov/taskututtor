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
[OpenRouter](https://openrouter.ai/keys) (default model `anthropic/claude-sonnet-5.5`; any OpenRouter
model id works), and the Anthropic API can be used directly instead. The key, your stories and your
progress are stored only in your browser; the key is sent only to the provider you chose.

## Install on Android

1. Open the deployed site in Chrome.
2. Menu (⋮) → **Add to Home screen** → **Install**.

## Develop

```bash
npm install
npm run dev      # local dev server
npm run build    # type-check and build to dist/
```

## Deploy

`.github/workflows/deploy.yml` builds and publishes to GitHub Pages on every push.
Enable it once under **Settings → Pages → Source: GitHub Actions**.

## How adaptation works

Level is a number where 1.0 = A1, 2.0 = A2, 3.0 = B1, 4.0 = B2, 5.0 = C1. The target is the
comprehensible-input sweet spot: looking up roughly 2–8 % of the distinct words in a chapter.
Fewer lookups or "too easy" nudges the level up; more lookups, many translated sentences or
"too hard" nudges it down (`src/adapt.ts`). The level, your still-learning words and your last
feedback go into the prompt for the next chapter (`src/ai.ts`).
