# Taskututtor production (server, subscription app, landing page)

Everything behind the paid product: the API, the subscription build of the app, and the promo
page. Readers sign in; their library syncs between devices; chapters are written in the
background with the service's own AI key. The open-source build in the repository root works
without any of this and serves as staging (see the main README).

It is one Cloudflare Worker:

| Piece | Cloudflare product | Holds |
|---|---|---|
| API + the web app's files | Worker with static assets | — |
| Database | D1 | profiles, series, chapters, jobs (JSON documents) |
| Pictures | R2 | chapter illustrations |
| Background writing | Queues | one message per requested chapter |

Sign-in is handled by [Clerk](https://clerk.com); the Worker only verifies the session token.
Stories, lookups and pictures go through one [OpenRouter](https://openrouter.ai) key that you own.

## How a chapter is made

1. The app asks for a chapter; the Worker checks the reader's daily limit and puts a job on the queue.
2. The queue consumer writes the **story** with `STORY_MODEL`, saves it and marks the job done.
   From this moment the reader can open and read the chapter.
3. It then writes the **word glossary** with the cheaper `GLOSSARY_MODEL`, from a list of the
   chapter's word forms that the code computes, so every word gets an entry.
4. If the reader has illustrations on, it paints the **picture** with `IMAGE_MODEL`, using an
   earlier picture of the series as reference, and stores it in R2.

Steps 3 and 4 reach the reader's devices through sync a few seconds later. If the glossary step
fails twice, the chapter stays marked as waiting and the app asks for it again
(`POST /api/chapters/:id/glossary`). The models were chosen by measurement:
see [docs/model-evaluation.md](../docs/model-evaluation.md).

## What gets deployed where

One deployment of this Worker gives one address with three things on it:

| Path | What | Comes from |
|---|---|---|
| `/` | landing page | `site/public/` |
| `/app/` | subscription app (sign-in required, no personal keys) | repository root, built with the server settings |
| `/api/*` | the API | `server/src/` |

`npm run deploy` builds the first two into `server/web/` and uploads everything. Attach your
domain under *Workers & Pages → taskututtor → Settings → Domains*.

**Staging** is separate and needs nothing from here: GitHub Pages rebuilds the open-source build
(own key, browser storage only, no sign-in) on every push. Try changes there, then deploy.

## Set up

You need a Cloudflare account, a Clerk application and an OpenRouter key.

```bash
cd server
npm install
npx wrangler login
```

1. Create the storage and put the database id that the first command prints into `wrangler.toml`
   (`database_id`):

   ```bash
   npx wrangler d1 create taskututtor
   npx wrangler r2 bucket create taskututtor-images
   npx wrangler r2 bucket create taskututtor-backups
   npx wrangler queues create taskututtor-jobs
   npm run db:remote
   ```

2. In Clerk, create an application with **Email code** as the only sign-in method. From its
   *API keys* page copy the **Publishable key** and the **JWKS public key** (PEM).

3. Store the secrets (you are prompted for each value; nothing is written to the repo):

   ```bash
   npx wrangler secret put OPENROUTER_API_KEY
   npx wrangler secret put CLERK_JWT_KEY
   ```

4. Deploy. The publishable key is public and is baked into the web app at build time (add
   `VITE_POSTHOG_KEY=phc_...` to the same command if you use analytics, see below):

   ```bash
   VITE_CLERK_PUBLISHABLE_KEY=pk_live_... npm run deploy
   ```

5. Set `ALLOWED_ORIGINS` in `wrangler.toml` to the address the deploy printed (or your own
   domain), add the same address to Clerk's allowed origins, and deploy again.

6. In Clerk, turn on *Waitlist* mode so that only people you approve can get in.

## Settings (`wrangler.toml`)

| Variable | Meaning |
|---|---|
| `STORY_MODEL` | OpenRouter model that writes chapters |
| `GLOSSARY_MODEL` | cheap model that writes each chapter's word glossary after the story |
| `LOOKUP_MODEL` | cheaper model for single-word lookups and dictionary entries |
| `IMAGE_MODEL` | model that paints illustrations |
| `DAILY_CHAPTER_LIMIT` | new chapters one reader may request per day (UTC) |
| `ALLOWED_ORIGINS` | comma-separated web origins that may call the API |
| `POSTHOG_KEY`, `POSTHOG_HOST` | analytics project token and region; empty key = analytics off |

## Analytics (PostHog)

Optional, and production only: the open-source build contains no tracking and sends nothing.

To switch it on, create a PostHog project for Taskututtor (EU region), copy its project token
(`phc_...`, public by design) and use it in two places:

- `POSTHOG_KEY` in `wrangler.toml`, for events from the server;
- `VITE_POSTHOG_KEY=phc_...` on the deploy command, for events from the app.

Set `POSTHOG_HOST` / `VITE_POSTHOG_HOST` only if your project is not on `https://eu.i.posthog.com`.

| Event | From | Tells you |
|---|---|---|
| `signed_in`, `signed_out`, `waitlist_opened` | app | who gets in and who is waiting |
| `onboarding_completed` | app | starting level, YKI goal |
| `screen_viewed` | app | which screens are used |
| `chapter_requested`, `chapter_ready`, `chapter_request_failed` | app | demand, and how long readers wait |
| `chapter_finished` | app | feedback, words looked up, question score, level change: the core learning loop |
| `listening_started`, `illustration_requested` | app | feature use |
| errors (`$exception`) | app | crashes, with the screen they happened on |
| `$ai_generation` | server | every AI call: model, tokens, cost in USD, latency, per reader (PostHog's LLM analytics) |
| `chapter_generated`, `chapter_generation_failed` | server | what was written and what failed, by stage |
| `daily_limit_reached`, `server_error` | server | readers hitting the cap; unexpected failures |

Useful first views: a funnel from `signed_in` to the third `chapter_finished`; retention on
`chapter_finished`; cost per reader as the sum of `$ai_total_cost_usd` by person.

What is deliberately not collected: story text, prompts, looked-up words, anything a reader
types, email addresses (readers appear under their Clerk account id), session recordings, and
clicks in general (autocapture is off). Nothing is stored on the reader's device for analytics,
so there is no analytics cookie. The landing site carries the privacy notice that says so
(`site/public/privacy.html`, written from [docs/privacy-draft.md](../docs/privacy-draft.md)).

**Surveys.** PostHog's in-app surveys are switched on in the app. Create one in PostHog
(*Surveys → New survey*, type *Popover*) and it appears for signed-in readers without a deploy.
To ask at a good moment, set *Display conditions → when the user sends an event* to
`chapter_finished`. A sensible first survey: after a reader's third finished chapter, "How likely
are you to recommend Taskututtor to someone learning Finnish?" with an optional comment. This is
the only PostHog feature that loads an extra script, and the reader's device remembers which
surveys it has already shown.

Automated browsers are ignored by PostHog; end-to-end tests that need to see their own events
build the app with `VITE_POSTHOG_COUNT_BOTS=1`.

## Problem reports

Readers can report a problem from Settings and from the end of any chapter: wrong Finnish, a wrong
translation, inappropriate content, a bug, or something else, with an optional description. (App
stores require a way to report AI-generated content.) Reports are stored in the `reports` table;
PostHog only receives a `problem_reported` event with the category.

Read the open ones:

```bash
npx wrangler d1 execute taskututtor --remote --command "SELECT created_at, category, user_id, chapter_id, message FROM reports WHERE status = 'new' ORDER BY created_at"
```

See the chapter a report is about, and mark reports as handled:

```bash
npx wrangler d1 execute taskututtor --remote --command "SELECT data FROM chapters WHERE id = '<chapter_id>'"
npx wrangler d1 execute taskututtor --remote --command "UPDATE reports SET status = 'done' WHERE status = 'new'"
```

There is no notification when a report arrives: check the table regularly, or add a PostHog
alert on the `problem_reported` event. In the open-source build the same button opens the
repository's issue form instead.

## Landing page

The promo page in [`site/public/`](../site/public) is plain HTML and CSS with no build step. It
goes out with every `npm run deploy` and is served at `/`.

- **Where its buttons lead:** only to `/app/` (sign in) and `/app/#join` (the waitlist). It does
  not link to the open-source build or the repository.
- **Waitlist:** switch on *Waitlist* mode in Clerk (*Configure → Restrictions*). "Join the
  waitlist" then opens Clerk's waitlist form, and you approve people in the Clerk dashboard. With
  the waitlist off, the same button opens normal sign-up.
- **No price yet:** the *Membership* section describes what is included and offers the waitlist.
  Add a price there once billing exists.
- **Privacy page:** `site/public/privacy.html` is linked from the footer and from the app's
  Settings. It contains two placeholders, for who operates the service and a contact address.
  `npm run deploy` stops with a message until you have filled them in.
- **Share image:** set `og:image` in `index.html` to a full address
  (`https://your-domain/img/og.png`); social networks do not follow relative ones.
- **Preview locally:** open `site/public/index.html` in a browser, or run `npm run build:web`
  and `npm run dev` here to see it at `/` with the app at `/app/`.

The screenshots in `site/public/img/` are real app screens showing a chapter and an illustration
produced during the model tests. Retake them after visible changes to the app.

There is no payment system yet: anyone you let in can read up to `DAILY_CHAPTER_LIMIT` new
chapters a day at your cost. The waitlist is what controls that for now.

## Backups

Two layers protect the database:

- **D1 Time Travel** (built in, always on): restore the database to any minute in the recent
  past with `npx wrangler d1 time-travel restore taskututtor --timestamp=<when>`.
- **Weekly export** (this repo): every Monday at 03:17 UTC the Worker writes the whole database
  as a gzipped SQL file to the `taskututtor-backups` bucket and keeps the newest `BACKUP_KEEP`
  files. To restore one:

  ```bash
  npx wrangler r2 object get taskututtor-backups/db/<file>.sql.gz --file backup.sql.gz
  gunzip backup.sql.gz
  npx wrangler d1 execute taskututtor --remote --file backup.sql
  ```

  Rows are written with `INSERT OR REPLACE`, so restoring over a live database brings exported
  rows back without touching rows created since.

The exports stay inside your Cloudflare account. For a copy that survives losing the account,
download a file with the first command above now and then and keep it elsewhere. They contain
readers' stories and progress, so do not put them anywhere public (including CI artifacts of a
public repository). Illustrations are not exported: R2 already stores them redundantly and
they can be regenerated.

## Run locally

```bash
cat > .dev.vars <<'VARS'
DEV_AUTH=1
OPENROUTER_API_KEY=sk-or-...
VARS
npm run db:local
npm run dev                                   # API on http://localhost:8787
```

and in the repository root, the subscription build of the app:

```bash
VITE_API_URL=http://localhost:8787 VITE_DEV_USER=me npm run dev
```

(Plain `npm run dev` there, without those variables, is the open-source build.)

`DEV_AUTH=1` together with `VITE_DEV_USER` signs you in as a fixed development user without
Clerk. Never set `DEV_AUTH` on a deployed Worker.

## API

All routes need `Authorization: Bearer <Clerk session token>`.

| Route | Purpose |
|---|---|
| `GET /api/state?since=<ms>` | profile, series and chapters changed since a timestamp |
| `PUT /api/profile` | level, preferences and word knowledge |
| `PUT /api/chapters/:id` | reading progress of a chapter |
| `POST /api/series` | start a new series (queues chapter 1) |
| `POST /api/series/:id/next` | queue the next chapter |
| `GET /api/jobs/:id` | status of a queued chapter |
| `DELETE /api/series/:id` | delete a series, its chapters and pictures |
| `GET /api/images/:chapterId` | a chapter's illustration |
| `POST /api/chapters/:id/illustrate` | paint or repaint an illustration |
| `POST /api/chapters/:id/glossary` | write a chapter's glossary if it is still missing |
| `POST /api/reports` | file a problem report |
| `POST /api/lookup`, `POST /api/dict` | AI word lookup and dictionary entry |

Sync is last-write-wins per document: fine for one reader moving between devices, not built
for two devices editing the same chapter at the same moment.
