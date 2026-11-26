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
| `LOOKUP_MODEL` | cheaper model for single-word lookups and dictionary entries |
| `IMAGE_MODEL` | model that paints illustrations |
| `DAILY_CHAPTER_LIMIT` | new chapters one reader may request per day (UTC) |
| `ALLOWED_ORIGINS` | comma-separated web origins that may call the API |

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
| `POST /api/lookup`, `POST /api/dict` | AI word lookup and dictionary entry |

Sync is last-write-wins per document: fine for one reader moving between devices, not built
for two devices editing the same chapter at the same moment.
