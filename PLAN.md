# Baby Names App — Build Plan

Derived from `SPEC.md` + analysis of `data/library.json` (2,061 names), revised after decisions on 2026-08-10.

## Decisions taken

| Question | Answer |
|---|---|
| Daily volume | **Endless stack, no daily cap.** Replaces the daily-batch model entirely. |
| Gender | **Both in the pool, filterable per session** (All / Girls / Boys toggle). |
| Extras | **Undo last swipe**, **surname preview on the card**. No match mode, no meanings lookup. |
| Database | **Supabase** — a `babynames` schema inside the existing *Imagine Worlds* project, reached by a dedicated `babynames_app` role scoped to that schema alone. |

---

## 0. Deviations from the spec (and why)

| # | Spec says | Plan says | Reason |
|---|---|---|---|
| 1 | 200 names/day in a cached `daily_batch` | **Rolling queue, no daily cap** | Your call, and it's the better architecture — see §3. It also deletes two whole classes of bug (below). |
| 2 | `name_key` = lowercase + trim + strip diacritics | Add an explicit fold map | NFD-stripping misses `ø`, `æ`, `ß`, `ł`, `đ`, `þ` and the Hawaiian okina `ʻ` (U+02BB — a modifier letter, not a combining mark). **7 library names would slip past the never-repeat guarantee.** |
| 3 | `decisions` stores name + meta | Also store `tags[]` and `source` | The style profile needs tags for *AI-sourced* liked names, which have no library row to look them up from. |
| 4 | Generate on load; optional cron at 00:05 | ~~Cron~~ **deleted** | Endless stack has no daily boundary, so nothing needs pre-warming on a schedule. |
| 5 | "today" is implicit | ~~`APP_TIMEZONE`~~ **deleted** | Was only needed to stop the batch flipping at 00:00 UTC instead of 01:00 BST. No daily boundary, no timezone bug. |
| 6 | Don't send exclusions to the model | Do send a *sample of recent passes* | Negative signal materially improves candidate quality. Correctness is still enforced in code — the model stays a candidate source, never a gatekeeper. |
| 7 | — | **Undo** + **surname preview** | Per your picks. |

Deviations 4 and 5 are worth calling out: choosing the endless stack didn't just change the UX, it removed the cron job, the timezone handling, and the date-keyed cache race. Meaningfully less to build and less to get wrong.

---

## 1. Stack

| Concern | Choice | Notes |
|---|---|---|
| Framework | Next.js 15, App Router, TypeScript | Route Handlers per spec §7, no Server Actions |
| Styling | Tailwind v4 | |
| Motion / swipe | `motion` (the renamed `framer-motion`) | Also gives `<Reorder.Group>` for drag-to-reorder — avoids a second dep like dnd-kit |
| Data fetching | SWR | `revalidateOnFocus` gives cheap two-person sync for free |
| DB driver | `postgres` (porsager) | Raw SQL, no ORM. Three tables don't justify Prisma/Drizzle. |
| Auth | `jose` (HS256 JWT in an httpOnly cookie) | |
| AI | `@anthropic-ai/sdk` | |

### Model choice

| Model | ID | Input /MTok | Output /MTok |
|---|---|---|---|
| Haiku 4.5 | `claude-haiku-4-5` | $1.00 | $5.00 |
| Sonnet 5 | `claude-sonnet-5` | $3.00 ($2.00 intro until 2026-08-31) | $15.00 ($10.00 intro) |

**Haiku 4.5**, overridable via `ANTHROPIC_MODEL`. A top-up call is ~2k in / ~3k out ≈ **1.7¢**, and with the endless stack it only fires when the queue runs low — roughly once per 60 names you actually decide on. Sonnet 5 would be ~5¢ per call, so switching later if stylistic matching disappoints costs nothing meaningful.

Two Haiku-specific constraints:
- `output_config.effort` **errors** on Haiku 4.5 — pass only `format`.
- Haiku 4.5 uses the legacy `thinking: {type:"enabled", budget_tokens:N}` shape. We don't need thinking, so omit it entirely.
- Prompt caching won't help: Haiku 4.5's minimum cacheable prefix is 4,096 tokens and our system prompt is far shorter. Don't build for it.

### Forcing valid JSON

Haiku 4.5 supports **structured outputs**, so we constrain the response to a schema rather than parsing prose:

```ts
const res = await anthropic.messages.create({
  model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5",
  max_tokens: 8000,
  system: STYLE_SYSTEM_PROMPT,
  messages: [{ role: "user", content: profileBlock }],
  output_config: {
    format: {
      type: "json_schema",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["names"],
        properties: {
          names: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["name", "gender", "origin"],
              properties: {
                name:   { type: "string" },
                gender: { type: "string", enum: ["girl", "boy", "neutral"] },
                origin: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
});
```

Check `stop_reason` before reading content (`max_tokens` → truncated; `refusal` → nothing). Spec §11's "parse defensively" still applies as a `try/catch` — schema-constrained output is guaranteed *well-formed*, not guaranteed to be *real names*.

---

## 2. Data model

```sql
-- Every name we've decided on. This IS the exclusion list.
CREATE TABLE decisions (
  name_key    TEXT PRIMARY KEY,
  display     TEXT NOT NULL,
  gender      TEXT,                            -- 'girl' | 'boy' | 'neutral'
  origin      TEXT,
  tags        JSONB   NOT NULL DEFAULT '[]',   -- ADDED (§0.3)
  source      TEXT    NOT NULL DEFAULT 'library', -- ADDED: 'library' | 'ai'
  verdict     TEXT    NOT NULL,                -- 'like' | 'pass'
  rank        INTEGER,
  decided_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX decisions_verdict_idx ON decisions (verdict);
CREATE INDEX decisions_rank_idx    ON decisions (rank) WHERE verdict = 'like';
CREATE INDEX decisions_recent_idx  ON decisions (decided_at DESC);

-- The rolling stack of undecided candidates. Rows are DELETEd on decision.
CREATE TABLE queue (
  name_key  TEXT PRIMARY KEY,
  display   TEXT   NOT NULL,
  gender    TEXT   NOT NULL,
  origin    TEXT,
  tags      JSONB  NOT NULL DEFAULT '[]',
  source    TEXT   NOT NULL,
  position  BIGINT NOT NULL,
  added_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX queue_pos_idx        ON queue (position);
CREATE INDEX queue_gender_pos_idx ON queue (gender, position);

-- Single-row app preferences.
CREATE TABLE preferences (
  id              INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  origins         JSONB   NOT NULL DEFAULT '[]',
  similar_new_mix NUMERIC NOT NULL DEFAULT 0.6,
  origin_mode     TEXT    NOT NULL DEFAULT 'soft',
  surname         TEXT,                        -- ADDED: for the card preview
  topup_threshold INTEGER NOT NULL DEFAULT 30  -- ADDED: per-gender low-water mark
);
```

`daily_batch` is gone. Migration lives in `db/001_init.sql`, applied by `npm run db:push` (a small script piping the file through the `postgres` client). No migration framework.

### Normalisation (`lib/nameKey.ts`)

The backbone of the never-repeat guarantee — everything compares on `name_key`, never display text.

```ts
export function nameKey(display: string): string {
  return display
    .normalize("NFD")
    .replace(/\p{M}/gu, "")            // combining marks: Gobán→Goban, Åke→Ake
    .toLowerCase()
    .replace(/[ʻʼ'’`´]/gu, "")         // okina + apostrophes: Naʻea→naea
    .replace(/ø/g, "o")                // no NFD decomposition
    .replace(/æ/g, "ae")
    .replace(/œ/g, "oe")
    .replace(/ß/g, "ss")
    .replace(/[đð]/g, "d")
    .replace(/ł/g, "l")
    .replace(/þ/g, "th")
    .replace(/[^a-z]/g, "")            // drops hyphens/spaces: Mary-Jane→maryjane
    .trim();
}
```

Order matters — the fold map runs *after* `toLowerCase()`. Unit-test the 7 tricky library entries (`Naʻea`, `Nauʻe`, `Vebjørn`, `Frøya`, `Gobán`, `Åke`, `Rüzgar`) plus `Zoë→zoe`, `Saoirse→saoirse`, and `Vebjørn ≡ Vebjorn`.

---

## 3. The rolling queue *(the core, replacing spec §6)*

`lib/queue.ts` + `lib/generate.ts`. `buildTopUp(input) → Candidate[]` stays a pure function so it's unit-testable with no DB and no network.

### Serving

```
GET /api/queue?gender=all|girl|boy&limit=25
  → SELECT * FROM queue [WHERE gender = $1] ORDER BY position LIMIT $2
```

The client keeps a local buffer and prefetches the next page when it's ~10 cards from the end, so swiping never blocks on the network.

### Top-up

Triggered on every `/api/queue` read, evaluated per gender so the session filter can never starve:

| Remaining (per gender) | Action |
|---|---|
| `> 30` | nothing |
| `≤ 30` | top up from the **library** inline — pure computation, <50ms, no AI |
| `≤ 30` **and** library candidates thin | fire an **AI** top-up in the background via `waitUntil()`; serve what we have now |
| `0` | block, generate, show a loading state |

Guarded by `pg_try_advisory_lock(hashtext('topup:' || gender))` — a second concurrent request skips the top-up rather than queueing behind it, so two people swiping simultaneously never double-generate or double-charge.

The chunk size per top-up is 60, split by `similar_new_mix` (default 36 library / 24 AI).

**This is strictly better than the daily batch for personalisation:** the style profile is recomputed on every top-up, so a name you like at 9pm influences what you see at 9:05pm rather than tomorrow morning.

### Style profile

From `decisions WHERE verdict='like'`:
- `originShare` — normalised tally of liked origins
- `tagWeights` — normalised tally of liked tags. **Weight these low.** 24 of the library's 30 tags just mirror the origin, so origin weight and tag overlap are heavily correlated; the genuinely independent signal is only `short` (451 names), `nickname` (52), `vintage` (48), `nature` (29), `unisex` (14), `doubled-sound` (3).
- `lengthProfile` — mean and stdev of liked display lengths (floor stdev at 1.5)
- Blend with `prefs.origins`: `w = 0.5·originShare + 0.5·normalise(prefWeights)`. If `origin_mode='hard'`, filter candidates to `prefs.origins` outright.

### Scoring a library candidate

```
score(c) = 0.25                                   // exploration floor — nothing unreachable
         + 1.00 · originWeight[c.origin]
         + 0.50 · (Σ tagWeights[t] for t in c.tags) / sqrt(c.tags.length)
         + 0.35 · exp(-((len(c) - meanLen)²) / (2·sd²))
```

**Weighted sample without replacement** — Efraimidis–Spirakis: assign each candidate `key = random()^(1/score)` and take the top *n*. Single pass, `O(n log n)`, unbiased. This is what keeps top-ups fresh; a plain "top *n* by score" would return the same names forever.

### AI top-up

Send: liked names (cap ~150 — top 60 by rank plus a random 90 if longer), ~40 recent passes as negative signal, origin prefs, and a short natural-language style description derived from the profile. Over-ask by 1.5×.

### Dedupe & assemble — the actual guarantee, all code-side

1. `nameKey()` every AI candidate
2. drop anything in `decisions` ∪ current `queue` ∪ already-seen-in-this-chunk
3. take `nNew` from survivors
4. short? top up from the leftover weighted library sample
5. still short? insert fewer and record it — **never error**
6. assign randomised `position` values within the chunk (this is the shuffle), append

### Cold start

No likes → fall back to `prefs.origins`. No prefs either → uniform-ish weighted sample across all 24 origins. Optionally pre-seed `decisions` with your existing favourites via `scripts/seed-decisions.ts` so the very first queue is already personalised.

---

## 4. API routes

| Route | Method | Notes |
|---|---|---|
| `/api/login` | POST | `timingSafeEqual` against `APP_PASSWORD`; sets signed httpOnly cookie (`sameSite=lax`, `secure`, 90d). Fixed delay on failure. |
| `/api/logout` | POST | |
| `/api/queue` | GET | Serve + trigger top-up per §3 |
| `/api/decide` | POST | Insert into `decisions`, delete from `queue`, in one transaction |
| `/api/decide/undo` | POST | Delete the most recent decision and put the name back at the front of the queue |
| `/api/liked` | GET | Ordered by `rank` |
| `/api/liked/reorder` | POST | Rewrites ranks in one statement |
| `/api/liked/remove` | POST | See open question §9 |
| `/api/preferences` | GET / PUT | |
| `/api/stats` | GET | `{liked, passed, queued}` for the header counter |

Everything except `/api/login` is gated by `middleware.ts` verifying the cookie.

**Atomic rank assignment** — stops two concurrent likes claiming the same rank:

```sql
INSERT INTO decisions (name_key, display, gender, origin, tags, source, verdict, rank)
VALUES ($1,$2,$3,$4,$5,$6,'like',
        (SELECT COALESCE(MAX(rank),0)+1 FROM decisions WHERE verdict='like'))
ON CONFLICT (name_key) DO NOTHING;
```

**Reorder** in one statement:

```sql
UPDATE decisions d SET rank = v.ord
FROM (SELECT unnest($1::text[]) AS name_key,
             generate_subscripts($1::text[], 1) AS ord) v
WHERE d.name_key = v.name_key AND d.verdict = 'like';
```

---

## 5. Frontend

Three screens plus login, bottom tab bar on mobile — this is a phone app in practice, two people on a sofa.

1. **`/login`** — single password field.
2. **`/` (Swipe)** — card stack rendering only the top 3 cards. Each card: name large, **surname in lighter type beneath it** (`Saoirse Strindberg`), then gender and origin. Drag past a threshold to commit; ← / → keys; explicit Pass/Like buttons for desktop; **Undo** button. Header shows `142 liked · 890 seen` rather than a fixed denominator — there's no total to count toward. Gender filter chip: All / Girls / Boys. Decisions are optimistic: state updates instantly, the write goes out in the background with a retry queue, a failed write rolls back with a toast.
3. **`/liked`** — `<Reorder.Group>` drag-to-reorder, persisted on drop. Sort chips A–Z / gender / origin / date liked — **these are views, not the stored order**; the stored order only changes on manual drag, and the UI should make that obvious (e.g. drag disabled while a sort chip is active).
4. **`/settings`** — origin chips with weight steppers, soft/hard toggle, similar↔new slider, surname field, top-up threshold.

Empty state when the library and AI are both tapped out: "That's everything for now — check back later," not an error.

---

## 6. File tree

```
app/
  layout.tsx  page.tsx  login/page.tsx  liked/page.tsx  settings/page.tsx
  api/{login,logout,queue,decide,liked,preferences,stats}/...
components/
  CardStack.tsx  NameCard.tsx  UndoButton.tsx  GenderFilter.tsx
  LikedList.tsx  OriginPicker.tsx  TabBar.tsx
lib/
  db.ts  session.ts  nameKey.ts  library.ts
  profile.ts  sample.ts  generate.ts  queue.ts  anthropic.ts
data/library.json
db/001_init.sql
scripts/{db-push.ts,seed-decisions.ts}
middleware.ts
```

---

## 7. Phases

| # | Phase | Deliverable |
|---|---|---|
| 1 | Skeleton | Next.js + Tailwind, schema applied, password login + middleware working end to end |
| 2 | Static loop | `nameKey` + tests, library loader, weighted sampler, library-only queue + top-up, swipe UI, `/api/decide`, **exclusion filter verified by test** |
| 3 | Liked list | View, sort chips, drag-reorder, un-like, **undo** |
| 4 | Preferences | Origins + weights + mode + mix + surname, wired into the profile |
| 5 | AI half | Anthropic call with structured outputs, dedupe/top-up, background `waitUntil` refill |
| 6 | Polish | Gestures, keyboard, gender filter, counters, empty state, deploy |

Phases 1–4 are fully functional with **no AI spend and no API key** — worth shipping and living with for a few days before phase 5.

---

## 8. Risks

**Library exhaustion — much less acute now.** The endless stack removed the forced 200/day burn, so you only consume what you actually swipe. 2,061 names lasts as long as your appetite does rather than 17 days. But it *does* eventually empty, at which point the AI is the sole source of new names and duplicate-after-dedupe rates will climb. Mitigations are already in the design: per-gender low-water marks, over-asking by 1.5×, top-up-from-leftovers, and inserting fewer rather than erroring. Passing on a name is what costs you library depth — skipping doesn't.

**Cold-start latency on an empty queue** — the one blocking AI call, 5–15s. Only happens if you swipe through 30+ names of one gender faster than the background refill completes. Mitigated by the low-water mark and a loading state.

**Two people swiping the same queue** — handled by `ON CONFLICT DO NOTHING` on decisions, delete-from-queue in the same transaction, `pg_try_advisory_lock` on top-ups, and SWR focus revalidation. Per spec §1, real-time sync is explicitly a non-goal; this is "eventually consistent within a few seconds," which is right for two people in the same room.

---

## 9. Resolved during the build

1. **Database** — `babynames` schema inside the existing Supabase project *Imagine Worlds*. Applied and verified. A separate project would have cost $10/month for isolation the data volume doesn't justify.
2. **Un-liking** — **permanent pass.** The row stays in `decisions` and loses its rank, so an un-liked name can never resurface.
3. **Visual direction** — warm off-white canvas, system serif (`ui-serif`/Iowan Old Style/Georgia — no webfont, so it works offline), deep teal accent, warm wash on like and cool wash on pass, no icons or confetti. Genuinely dark dark-mode.

## 10. Six things found and fixed while building

**The style profile was halving its own signal.** The blend was
`0.5·likedShare + 0.5·prefShare`. With no origin preferences stated, `prefShare`
is all zeros — so your actual swiping behaviour was scaled to half strength
against nothing. Each side now only yields half when the *other* side has data.
Caught by a test asserting that liking 12 Irish names visibly shifts the mix; it
was moving 7.3% → 9.0%.

**Confidence shrinkage added.** With the blend fixed, a *single* like would have
reshaped the entire next chunk. The liked signal is now damped by
`n / (n + 10)`, so one like nudges and fifty pull hard. Both behaviours are
pinned by tests.

Origin coefficient raised 1.0 → 2.0 and the exploration floor lowered 0.25 →
0.2, tuned so a settled single-origin preference reaches ~2× its library share
rather than crowding everything out.

**An outage rendered as a successful empty state.** The SWR fetcher was
`fetch(url).then(r => r.json())`, which resolves for 4xx/5xx too — so a 500
handed SWR the error body and the swipe screen cheerfully announced *"That's
everything for now."* Caught by running the app against a deliberately
unconfigured database. `lib/fetcher.ts` now throws on non-OK, the swipe screen
has a separate error state, and a 401 (expired session) hard-navigates to
`/login` rather than showing empty pages forever.

**Every jsonb write was double-encoding.** `${JSON.stringify(x)}::jsonb` looks
correct but postgres.js re-encodes a JS string bound for a jsonb cast, so the
column ended up holding the *string* `"[\"short\"]"` rather than the array
`["short"]`. Proven with a three-way probe against the live database:

| expression | resulting `jsonb_typeof` |
|---|---|
| `${JSON.stringify(arr)}::jsonb` | `string` ❌ |
| `${sql.json(arr)}::jsonb` | `array` ✅ |

This hit `queue.tags`, `decisions.tags` *and* `preferences.origins` — all four
write sites. The damage was silent rather than loud: `buildProfile` does
`for (const tag of tags)`, which iterates **characters** on a string, so the tag
signal would have quietly vanished; a double-encoded `origins` would have broken
origin weighting the same way. Fixed with `sql.json()` everywhere, plus a
`toTags()` coercion on read and `jsonb_to_recordset` (which types each column
explicitly) for the bulk insert. Regression test in `nameKey.test.ts`.

**Swiping never committed.** `animate(...).then(...)` — Motion 13's
`AnimationPlaybackControls` exposes `finished: Promise` and is *not* itself a
thenable, so `commit()` threw before reaching `onDecide`. TypeScript missed it
(the `animate` overload returns a loose type) and the API was provably fine;
only clicking the button in a browser and watching the database stay empty
found it. Now uses `.finished.then(finish, finish)` — settling on **both**
paths, because a cancelled animation would otherwise leave `busy = true` and
wedge the entire card stack permanently.

**A leaked advisory lock could permanently wedge the queue.** Top-ups were
guarded by session-level `pg_try_advisory_lock` / `pg_advisory_unlock`. Session
advisory locks belong to a *connection*, but Supabase's transaction pooler is
free to route the later unlock to a different backend than the one holding the
lock — so the unlock silently no-ops and the lock is held forever. Every
subsequent top-up then returns `{ran: false, reason: "locked"}` and the queue can
never refill again: the app quietly dies once you swipe past the low-water mark.

Found by emptying the queue and watching it refuse to regenerate, then
confirming two stranded locks in `pg_locks`. This only reproduces on a *pooled*
connection — which is exactly the deployment target, so local testing against a
direct connection would never have shown it. Now uses
`pg_try_advisory_xact_lock` inside `sql.begin()`: transaction-scoped locks are
released by the COMMIT itself, and postgres.js pins one connection per
transaction so the pooler cannot split the pair. Verified with three
back-to-back regeneration rounds (60 + 60 each, zero locks left behind).

## 11. Test notes

`lib/generate.test.ts` averages each measurement over 25 draws. Sampling is
deliberately stochastic, so single-draw assertions were failing ~40% of runs —
and the threshold was originally set *at* the measured mean, which is a coin
flip by construction regardless of code quality. Thresholds now sit below the
observed floor: 0 failures across 20 consecutive full runs.
