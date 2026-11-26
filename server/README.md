# Taskututtor server (account mode)

The optional backend behind signed-in accounts: library sync between devices, chapters written in
the background, and no API key for the reader. The app works without it — see the main README.

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

| Deployment | Folder | Cloudflare name | What it is |
|---|---|---|---|
| App + API | `server/` | `taskututtor` | this Worker; also serves the web app's files |
| Landing page | `site/` | `taskututtor-site` | static promo site, no code |

The public personal-key version of the app is separate again: GitHub Pages builds it from the
repository root on every push. A typical domain layout is the landing page on `example.com` and
the app on `app.example.com`; set each under *Workers & Pages → the Worker → Settings → Domains*.

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

4. Deploy. The publishable key is public and is baked into the web app at build time:

   ```bash
   VITE_CLERK_PUBLISHABLE_KEY=pk_live_... npm run deploy
   ```

5. Set `ALLOWED_ORIGINS` in `wrangler.toml` to the address the deploy printed (or your own
   domain), add the same address to Clerk's allowed origins, and deploy again.

## Settings (`wrangler.toml`)

| Variable | Meaning |
|---|---|
| `STORY_MODEL` | OpenRouter model that writes chapters |
| `GLOSSARY_MODEL` | cheap model that writes each chapter's word glossary after the story |
| `LOOKUP_MODEL` | cheaper model for single-word lookups and dictionary entries |
| `IMAGE_MODEL` | model that paints illustrations |
| `DAILY_CHAPTER_LIMIT` | new chapters one reader may request per day (UTC) |
| `ALLOWED_ORIGINS` | comma-separated web origins that may call the API |

## Landing page

The promo site in [`site/`](../site) is plain HTML and CSS with no build step:

```bash
cd site
npx wrangler deploy
```

Wrangler prints the address (`taskututtor-site.<your-subdomain>.workers.dev`). Before or after
you attach your own domain:

- **Links:** the page links to the app and to the source repository. Both addresses are listed in
  a comment at the top of `site/public/index.html`; replace them when the app moves to your domain.
- **Share image:** set `og:image` in `index.html` to a full address (`https://your-domain/img/og.png`);
  social networks do not follow relative ones.
- **Pricing:** the page says account pricing "will be announced". Edit the *Two ways to use it*
  section when you have a price.

The screenshots in `site/public/img/` are real app screens showing a chapter and an illustration
produced during the model tests. Retake them after visible changes to the app.

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

and in the repository root:

```bash
VITE_API_URL=http://localhost:8787 VITE_DEV_USER=me npm run dev
```

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
| `POST /api/lookup`, `POST /api/dict` | AI word lookup and dictionary entry |

Sync is last-write-wins per document: fine for one reader moving between devices, not built
for two devices editing the same chapter at the same moment.
