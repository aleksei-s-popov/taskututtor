# Which models, and why

The default story and illustration models were chosen by measurement in November 2026, not by
reputation. This page records how, so the choice can be repeated when models and prices change.

## Method

**Stories.** Each model wrote chapter 1 of a new series through the app's real prompt
(`src/story.ts`), at up to four reader levels (absolute beginner, A1, A2, about B1), with YKI mode
on. Claude Opus 5.5 then graded every chapter blind, 1–10, as a strict native editor: Finnish
correctness (with every error listed), fit to the level, storytelling, translation accuracy and a
sample of the glossary. Finalists also wrote chapters 2 and 3 from their own plot plan and were
graded on following it. Cost is what OpenRouter charged per chapter.

**Illustrations.** Each model painted one scene from a series' art description, then a second
scene with the first picture attached as reference. Judged by eye for quality, for matching the
first picture's characters and style, and for following the scene.

Small samples (two to four chapters, two pictures per model) and a model as grader: good enough to
separate the field, not to rank near-ties.

## Story models

| Model | Open weights | Cost / chapter | Finnish | Level fit | Story | Glossary | Length vs target |
|---|---|---|---|---|---|---|---|
| GPT-6 Luna | | $0.005 | 8.5 | 7.2 | 7.5 | 7.2 | 90% |
| Gemini 3.1 Flash Lite | | $0.007 | 7.5 | 6.0 | 7.0 | 8.0 | 40% |
| Claude Haiku 5.5 | | $0.012 | 8.0 | 6.8 | 6.8 | 7.8 | 63% |
| DeepSeek V4.1 Flash | yes | $0.015 | 7.8 | 7.8 | 7.5 | 8.8 | 86% |
| GLM-5.3 | yes | $0.03 | 5.0 | 6.5 | 7.0 | 5.0 | 88% |
| **GPT-6.1 Terra** (default) | | **$0.040** | **8.5** | 7.5 | **8.5** | **9.0** | 93% |
| Meta Muse Spark Open | yes | $0.04 | 6.5 | 7.5 | 7.5 | 6.5 | 84% |
| Qwen3.8 27B | yes | $0.04 | 4.0 | 7.0 | 6.0 | 5.0 | — |
| Mistral Large 4 | yes | $0.070 | 6.0 | 7.0 | 6.5 | 7.0 | 95% |
| DeepSeek V4 Pro | yes | $0.07 | 8.0 | 7.0 | 7.5 | 9.0 | 100% |
| Claude Sonnet 5.5 (previous default) | | $0.082 | 8.0 | 6.5 | 7.8 | 8.5 | 48% |
| Gemini 3.8 Flash | | $0.096 | 7.5 | 5.0 | 7.5 | 9.0 | 100% |
| Qwen3.8 2.4T | yes | $0.10 | 8.5 | 7.5 | 8.0 | 8.5 | 89% |
| Kimi K3.1 Pro | yes | $0.11 | 8.5 | 7.0 | 8.0 | 8.0 | 68% |

Findings:

- **GPT-6.1 Terra** had the cleanest Finnish, the best stories and glossary, wrote to length, and
  was the only finalist that repeated no events across chapters 1–3. Half the price of the
  previous default. It is slow (about two minutes a chapter).
- **DeepSeek V4.1 Flash** is the best-value open-weight model: a few more Finnish errors per
  chapter, about a third of Terra's price. It follows a plot plan but tends to reveal secrets early.
- **GPT-6 Luna** writes Finnish as clean as Terra's for an eighth of the price, with weaker plot
  logic.
- The best open-weight models (Qwen3.8 2.4T, Kimi K3.1 Pro) match Terra's quality but cost more and
  run slower. Small open models (27B class) are not usable for Finnish at beginner level.
- Tencent Hy4, Cohere Command A+ and Xiaomi MiMo Pro timed out on every attempt.

## Splitting the work between two models

More than half of what a writer produces per chapter is the word glossary, not the story. Two
ways of mixing models were tested on the same story.

**Story by one model, glossary by a cheaper one (adopted).** GPT-6.1 Terra wrote three chapters
(A1, A2, about B1) without a glossary; four cheap models each wrote the glossary from a list of
the chapter's distinct word forms.

| Glossary by | Glossary accuracy | Glossary cost | Whole chapter | Whole chapter time |
|---|---|---|---|---|
| Terra itself (one call) | 8.5–9 | included | $0.040 | about 120 s |
| **GPT-6 Luna** (default) | 8.3 | $0.003 | **$0.023** | 85 s |
| DeepSeek V4.1 Flash | 9.0 | $0.012 | $0.033 | 140 s |
| Gemini 3.1 Flash Lite | 8.3 | $0.015 | $0.035 | 78 s |
| Claude Haiku 5.5 | 7.3 | $0.007 | $0.027 | 99 s |

Story quality was unchanged, the chapter costs about 40% less, and because the word list comes
from code, every word gets an entry (100% coverage in all twelve runs, against 96–100% when the
writer chose what to include). The story is also readable after about a minute, before the
glossary exists, which is how the app now shows it.

**Strong model starts, cheap model continues (not adopted).** Terra wrote chapter 1 and the plot
plan; a cheaper model wrote chapters 2 and 3.

| Setup | Follows plan | Consistency | Plot moves | Repeated events | Cost per later chapter |
|---|---|---|---|---|---|
| Terra throughout | 9 | 8 | 9 | 0 | $0.036 |
| Terra, then DeepSeek V4.1 Flash | 8 | 6 | 8 | 2 | $0.012 |
| Terra, then GPT-6 Luna | 8 | 6 | 8 | 2 | $0.007 |

A good plan lifts the cheaper models, but small contradictions creep in (a date that changes, a
key found twice). Cheaper, at a cost in exactly the consistency readers notice.

## Illustration models

| Model | Cost / picture | Result |
|---|---|---|
| Recraft V4.1 Flash | $0.007 | cannot take a reference picture, so characters do not match |
| Flux 3 Klein | $0.009 | clean and consistent, brighter and less atmospheric |
| **MAI Image 2.7 Flash** (default) | **$0.010** | close to the requested style, same characters in both scenes |
| Krea 2 Medium Turbo | $0.015 | consistent but flat |
| Flux.2 Klein 4B (open weights) | $0.015 | copied the first picture instead of drawing the second scene |
| Seedream 5.0 Flash | $0.018 | very good; adds fake signatures in the corners |
| Qwen Image 2.1 Turbo | $0.018 | drifts to a photographic look, faces change |
| Gemini 3.1 Flash Lite Image | $0.034 | very good, consistent |
| Gemini Nano Banana 2.1 (previous default) | $0.047 | best overall |
| GPT Image 1 Mini | $0.052 | murky, and not cheaper |

## What the tests changed in the prompts

- **YKI topics are planned, not assigned.** Giving each chapter a topic made every model insert an
  unrelated errand (a health-centre visit in the middle of a mystery). The plot plan now places
  its events in everyday YKI situations, and chapters are told never to add a scene just to cover
  a topic. Re-test with Terra: plan-following 8 → 9, progress 7 → 9, no filler reported.
- **A real minimum length.** Some models wrote half the requested words.
- **No textbook names.** Left alone, every model named its heroine Aino.
- **Glossary notes name the case actually used**, and above-level vocabulary is limited to a few
  guessable words.

## Cost of a heavy month (150 chapters with pictures)

| Setup | Per month |
|---|---|
| Previous defaults: Claude Sonnet 5.5 + Nano Banana 2.1 | about $19 |
| GPT-6.1 Terra writing story and glossary + MAI Image 2.7 Flash | about $7.50 |
| **Current defaults: GPT-6.1 Terra story + GPT-6 Luna glossary + MAI Image 2.7 Flash** | **about $5** |
| Open-weight writer: DeepSeek V4.1 Flash + MAI Image 2.7 Flash | about $3.70 |
| Cheapest tested: GPT-6 Luna + Flux 3 Klein | about $2.10 |
