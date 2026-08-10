# Names

A two-person baby-name shortlist. One shared password, one shared list, an
endless stack of candidates that adapts as you swipe.

Built to [`SPEC.md`](SPEC.md); the design decisions and deviations are recorded
in [`PLAN.md`](PLAN.md).

---

## One-time setup

### 1. Database — already done

The schema lives in the `babynames` schema of the Supabase project **Imagine
Worlds**, namespaced so it cannot touch the 82 tables in `public`.

The app connects as a dedicated Postgres role, **`babynames_app`**, not as the
master `postgres` user. That role is granted only `babynames`, so even a bug
here cannot read or damage Imagine Worlds data — verified: the role sees zero
tables in `public`. `DATABASE_URL` in `.env.local` is already set to it.

To rotate that password later:

```sql
ALTER ROLE babynames_app WITH PASSWORD 'new-password-here';
```

…then update `DATABASE_URL`. Nothing else uses this credential.

`.env.local` is gitignored and already holds a generated `SESSION_SECRET` and
`APP_PASSWORD` — change the app password to whatever you two will actually
remember.

### 2. (Optional) Add an Anthropic key

```
ANTHROPIC_API_KEY=sk-ant-...
```

**The app works without this.** With no key, names come from the 2,061-name
library only. With a key, roughly 40% of each top-up is freshly generated to
match your taste. Cost is about 1.7¢ per top-up, which happens roughly once per
60 names you decide on.

### 3. Run it

```bash
npm run dev
```

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Local dev server |
| `npm run build` | Production build |
| `npm test` | Unit tests (normalisation + generation pipeline) |
| `npm run db:push` | Re-apply `db/*.sql`. Idempotent — safe to re-run. |

---

## How it works

**The never-repeat guarantee.** Every name reduces to a `name_key` — lowercased,
diacritics stripped, plus an explicit fold map for the characters NFD misses
(`ø`, `æ`, `ß`, `ł`, and the Hawaiian okina `ʻ`, which is a modifier *letter*,
not a combining mark). Seven library names depend on that fold map. All dedupe
and exclusion checks compare on `name_key`, never on display text. The AI is
only ever a source of candidates — the guarantee is enforced in code, in
`lib/generate.ts`.

**The rolling queue.** There is no daily batch. `queue` holds undecided
candidates; rows are deleted as you decide. When either gender drops below the
low-water mark (default 30), a 60-name chunk is generated — 60% weighted-sampled
from the library, 40% from Claude — and appended. Refills happen in the
background so swiping never blocks on the network.

**Personalisation.** A style profile is rebuilt on every top-up from what you've
liked: origin distribution, style tags, and name length. Candidates are scored
against it and drawn by Efraimidis–Spirakis weighted sampling, so high-scoring
names appear more often while everything stays reachable. The liked signal is
shrunk toward uniform when it rests on few observations — one like nudges,
fifty pull hard.

**Two people, one account.** Decisions are optimistic and roll back on failure.
Top-ups are guarded by a Postgres try-lock, so simultaneous swiping never
double-generates or double-charges. Returning to the tab refreshes what the
other person did.

---

## Deploying to Vercel

Push to GitHub, import the repo, and set these environment variables:

```
DATABASE_URL
DB_SCHEMA=babynames
APP_PASSWORD
SESSION_SECRET
ANTHROPIC_API_KEY      # optional
ANTHROPIC_MODEL        # optional, defaults to claude-haiku-4-5
```

No cron job is needed — the endless-stack design has no daily boundary to
pre-warm.
