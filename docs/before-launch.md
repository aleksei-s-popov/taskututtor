# Before launch: things only the owner can do

A reminder list. None of this can be done from the code; each item needs a decision, an account
or a detail that only the person running the service has.

## 1. Fill in the operator details on the privacy page

`site/public/privacy.html` has two placeholders, and `npm run deploy` refuses to run until both
are replaced.

**What "operator" means.** Whoever runs the service and is legally responsible for the personal
data it holds. EU law calls this the *data controller*. A privacy notice must name them, so that
readers know who has their data and whom to contact. For Taskututtor that is the owner, as
either:

- a private person or sole trader (in Finland, a *toiminimi*): your name, or your business name;
- a company: its registered name.

**What to put in.**

| Placeholder | Replace with |
|---|---|
| `[OPERATOR NAME AND ADDRESS]` | That name plus a postal address. For a company, add the business ID (*Y-tunnus*). |
| `[CONTACT EMAIL]` | An address where readers can ask about, correct or delete their data, e.g. `privacy@your-domain`. |

**Keep in mind.**

- The address will be public. If you operate as a private person and do not want your home
  address on the page, the usual routes are registering a business with a business address, or a
  registered-office / mailbox service. Whether an email alone is enough is a legal question.
- Use a dedicated email, not a personal one. It stays public, including in old copies of the
  page. The same address can double as the support contact.
- Once readers pay, Finnish consumer law also expects the seller to identify themselves, so
  these details are needed on the site anyway.
- The page was written from what the code does, not by a lawyer. For a paid service aimed at
  people in Finland, have it checked before launch.

## 2. Other open items

- [ ] **OpenRouter key.** Revoke the key that was pasted into a chat earlier, and use a fresh one
      as the server's `OPENROUTER_API_KEY`.
- [ ] **Cloudflare.** Create the account, database, two storage buckets and queue, then deploy
      (steps in [`server/README.md`](../server/README.md#set-up)). Check whether Queues needs the
      paid plan.
- [ ] **Clerk.** Create the application with *Email code* as the only sign-in method, and turn on
      *Waitlist* mode so that only approved people get in.
- [ ] **PostHog.** Create a separate project for Taskututtor (EU region) rather than reusing the
      existing one, and put its token in `POSTHOG_KEY` and `VITE_POSTHOG_KEY`.
- [ ] **Domain.** Attach it to the Worker, then set `ALLOWED_ORIGINS` and Clerk's allowed origins
      to it, and change `og:image` in `site/public/index.html` to a full address.
- [ ] **First survey.** Create it in PostHog (suggestion in `server/README.md`).
- [ ] **Reports.** Decide how often to check the `reports` table, or set a PostHog alert on
      `problem_reported`.
- [ ] **Pricing and billing.** Not built. Until it is, everyone you approve reads at your cost,
      up to the daily chapter limit.
- [ ] **App stores.** Later: developer accounts, a Mac or cloud build service for iOS, and
      in-app purchases.
