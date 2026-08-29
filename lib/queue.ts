import { q, sql, t, type SqlHandle } from "./db.ts";
import { buildTopUp } from "./generate.ts";
import { buildProfile } from "./profile.ts";
import {
  DEFAULT_PREFERENCES,
  MAX_HEARTS,
  type Candidate,
  type Decision,
  type GenderFilter,
  type Preferences,
} from "./types.ts";

const TOPUP_CHUNK = 60;

/* ------------------------------------------------------------------ reads */

export async function getPreferences(h: SqlHandle = sql): Promise<Preferences> {
  const s = h as typeof sql;
  const [row] = await s<Preferences[]>`
    SELECT origins, similar_new_mix::float8 AS similar_new_mix, origin_mode,
           surname, topup_threshold
    FROM ${q(h, "preferences")} WHERE id = 1`;
  return row ? { ...DEFAULT_PREFERENCES, ...row } : DEFAULT_PREFERENCES;
}

export async function getLiked(h: SqlHandle = sql): Promise<Decision[]> {
  const s = h as typeof sql;
  return s<Decision[]>`
    SELECT * FROM ${q(h, "decisions")}
    WHERE verdict = 'like' ORDER BY rank ASC NULLS LAST, decided_at ASC`;
}

export async function getRecentPasses(
  limit = 40,
  h: SqlHandle = sql,
): Promise<Decision[]> {
  const s = h as typeof sql;
  return s<Decision[]>`
    SELECT * FROM ${q(h, "decisions")}
    WHERE verdict = 'pass' ORDER BY decided_at DESC LIMIT ${limit}`;
}

export async function getStats() {
  const [row] = await sql<
    { liked: number; passed: number; queued: number }[]
  >`
    SELECT
      (SELECT count(*)::int FROM ${t("decisions")} WHERE verdict = 'like') AS liked,
      (SELECT count(*)::int FROM ${t("decisions")} WHERE verdict = 'pass') AS passed,
      (SELECT count(*)::int FROM ${t("queue")}) AS queued`;
  return row;
}

export async function readQueue(
  gender: GenderFilter,
  limit: number,
): Promise<Candidate[]> {
  if (gender === "all") {
    return sql<Candidate[]>`
      SELECT name_key, display, gender, origin, tags, source
      FROM ${t("queue")} ORDER BY position ASC LIMIT ${limit}`;
  }
  return sql<Candidate[]>`
    SELECT name_key, display, gender, origin, tags, source
    FROM ${t("queue")}
    WHERE gender IN (${gender}, 'neutral')
    ORDER BY position ASC LIMIT ${limit}`;
}

/** Remaining undecided names per gender, used to drive the low-water mark. */
async function queueDepth(): Promise<{ girl: number; boy: number }> {
  const rows = await sql<{ gender: string; n: number }[]>`
    SELECT gender, count(*)::int AS n FROM ${t("queue")} GROUP BY gender`;
  const by = Object.fromEntries(rows.map((r) => [r.gender, r.n]));
  const neutral = by["neutral"] ?? 0;
  return {
    girl: (by["girl"] ?? 0) + neutral,
    boy: (by["boy"] ?? 0) + neutral,
  };
}

/* ----------------------------------------------------------------- writes */

export async function decide(input: {
  candidate: Candidate;
  verdict: "like" | "pass";
}): Promise<void> {
  const { candidate: c, verdict } = input;
  await sql.begin(async (tx) => {
    const decisions = q(tx, "decisions");
    // Rank is computed inside the INSERT so two simultaneous likes can never
    // claim the same position.
    const rank =
      verdict === "like"
        ? tx`(SELECT COALESCE(MAX(rank),0)+1 FROM ${q(tx, "decisions")} WHERE verdict = 'like')`
        : tx`NULL`;
    await tx`
      INSERT INTO ${decisions}
        (name_key, display, gender, origin, tags, source, verdict, rank)
      VALUES (${c.name_key}, ${c.display}, ${c.gender}, ${c.origin},
              ${sql.json(c.tags ?? [])}::jsonb, ${c.source}, ${verdict},
              ${rank})
      ON CONFLICT (name_key) DO NOTHING`;
    await tx`DELETE FROM ${q(tx, "queue")} WHERE name_key = ${c.name_key}`;
  });
}

/** Undo the most recent decision and put the name back at the head of the queue. */
export async function undoLast(): Promise<Decision | null> {
  return sql.begin(async (tx) => {
    const [row] = await tx<Decision[]>`
      DELETE FROM ${q(tx, "decisions")}
      WHERE name_key = (
        SELECT name_key FROM ${q(tx, "decisions")}
        ORDER BY decided_at DESC LIMIT 1
      )
      RETURNING *`;
    if (!row) return null;
    await tx`
      INSERT INTO ${q(tx, "queue")}
        (name_key, display, gender, origin, tags, source, position)
      VALUES (${row.name_key}, ${row.display}, ${row.gender}, ${row.origin},
              ${sql.json(row.tags ?? [])}::jsonb, ${row.source},
              (SELECT COALESCE(MIN(position), 0) - 1 FROM ${q(tx, "queue")}))
      ON CONFLICT (name_key) DO NOTHING`;
    return row;
  });
}

async function insertCandidates(
  candidates: Candidate[],
  h: SqlHandle = sql,
): Promise<number> {
  if (!candidates.length) return 0;

  // Send one JSON document and let Postgres shred it into rows.
  //
  // Two traps here, both of which produce a jsonb *string* instead of an array:
  //   1. The `INSERT ... ${sql(rows)}` bulk helper cannot express a per-column
  //      jsonb cast, so a pre-stringified `tags` is encoded a second time.
  //   2. `${JSON.stringify(x)}::jsonb` does the same — postgres.js re-encodes a
  //      JS string bound for a jsonb cast. Use sql.json(x), which does not.
  // The damage is silent rather than loud: tags reads back as a string, and
  // buildProfile's `for (const tag of tags)` then iterates characters, so the
  // tag signal quietly vanishes. jsonb_to_recordset types every column
  // explicitly, so the shape is checked at the boundary.
  const payload = candidates.map((c) => ({
    name_key: c.name_key,
    display: c.display,
    gender: c.gender,
    origin: c.origin,
    tags: c.tags ?? [],
    source: c.source,
  }));

  const s = h as typeof sql;
  const inserted = await s<{ name_key: string }[]>`
    INSERT INTO ${q(h, "queue")} (name_key, display, gender, origin, tags, source)
    SELECT name_key, display, gender, origin, tags, source
    FROM jsonb_to_recordset(${sql.json(payload)}::jsonb) AS x(
      name_key TEXT, display TEXT, gender TEXT,
      origin TEXT, tags JSONB, source TEXT
    )
    ON CONFLICT (name_key) DO NOTHING
    RETURNING name_key`;
  return inserted.length;
}

/* --------------------------------------------------------------- top-ups */

export interface TopUpOutcome {
  ran: boolean;
  gender?: "girl" | "boy";
  inserted?: number;
  meta?: Record<string, unknown>;
  reason?: string;
}

/**
 * Refill one gender's share of the queue. If another request is already topping
 * up, this one returns immediately rather than queueing behind it, so two people
 * swiping at once never double-generate or double-charge for AI.
 *
 * The lock MUST be transaction-scoped (pg_try_advisory_xact_lock), not
 * session-scoped. Session-level advisory locks belong to a *connection*, and
 * Supabase's transaction pooler is free to route the later
 * `pg_advisory_unlock` to a different backend than the one holding the lock —
 * the unlock then silently no-ops and the lock leaks forever, permanently
 * wedging every future top-up. A transaction-scoped lock is released by the
 * COMMIT itself, and postgres.js pins one connection for the whole
 * transaction, so the pooler cannot split the pair.
 */
export async function topUpGender(
  gender: "girl" | "boy",
  opts: { allowAi: boolean },
): Promise<TopUpOutcome> {
  const lockKey = gender === "girl" ? 8801 : 8802;

  return sql.begin(async (tx): Promise<TopUpOutcome> => {
    const [{ locked }] = await tx<{ locked: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(${lockKey}) AS locked`;
    if (!locked) return { ran: false, reason: "locked" };

    const [prefs, liked, recentPasses] = await Promise.all([
      getPreferences(tx),
      getLiked(tx),
      getRecentPasses(40, tx),
    ]);

    const excludedRows = await tx<{ name_key: string }[]>`
      SELECT name_key FROM ${q(tx, "decisions")}
      UNION ALL
      SELECT name_key FROM ${q(tx, "queue")}`;
    const excluded = new Set(excludedRows.map((r) => r.name_key));

    const profile = buildProfile(liked, prefs);
    const { candidates, meta } = await buildTopUp({
      gender,
      count: TOPUP_CHUNK,
      liked,
      recentPasses,
      prefs,
      profile,
      excluded,
      allowAi: opts.allowAi,
    });

    const inserted = await insertCandidates(candidates, tx);
    return { ran: true, gender, inserted, meta };
  });
}

/* ------------------------------------------------------------ liked list */

/**
 * Remove from the shortlist. Per the build decision this is a *permanent pass*
 * — the name stays in `decisions` so it can never resurface, it just loses its
 * rank. (The spec left this open; showing a name you already rejected once is
 * more annoying than losing the option to re-like it.)
 *
 * Hearts are left intact so `relike` can restore the row exactly as it was when
 * the swipe-to-remove undo is taken.
 */
export async function unlike(nameKey: string): Promise<void> {
  await sql`
    UPDATE ${t("decisions")}
    SET verdict = 'pass', rank = NULL
    WHERE name_key = ${nameKey} AND verdict = 'like'`;
}

/**
 * Undo a removal. The row is still in `decisions` as a pass, so this is a flip
 * back rather than a re-insert — which is also why hearts survive: `unlike`
 * only clears the rank.
 */
export async function relike(
  nameKey: string,
  rank: number | null,
): Promise<void> {
  await sql`
    UPDATE ${t("decisions")} SET
      verdict = 'like',
      rank = COALESCE(
        ${rank}::int,
        (SELECT COALESCE(MAX(rank), 0) + 1 FROM ${t("decisions")} WHERE verdict = 'like')
      )
    WHERE name_key = ${nameKey} AND verdict = 'pass'`;
}

/**
 * Set a name's heart count, clamped to 0–MAX_HEARTS.
 *
 * Gaining a heart also floats the name to the top of the shortlist — that jump
 * *is* the feedback for the double-tap, so it happens in the same statement
 * rather than as a follow-up reorder that could half-apply. Ranks are only ever
 * compared, never assumed contiguous, so MIN(rank) - 1 going negative is fine;
 * the next drag renumbers from 1 anyway.
 */
export async function setHearts(
  nameKey: string,
  hearts: number,
): Promise<void> {
  const h = Math.max(0, Math.min(MAX_HEARTS, Math.trunc(hearts) || 0));
  await sql`
    UPDATE ${t("decisions")} d SET
      hearts = ${h},
      rank = CASE WHEN ${h} > 0
        THEN (SELECT COALESCE(MIN(rank), 1) - 1 FROM ${t("decisions")} WHERE verdict = 'like')
        ELSE d.rank
      END
    WHERE d.name_key = ${nameKey} AND d.verdict = 'like'`;
}

export async function reorderLiked(orderedKeys: string[]): Promise<void> {
  if (!orderedKeys.length) return;
  await sql`
    UPDATE ${t("decisions")} d
    SET rank = v.ord
    FROM (
      SELECT unnest(${orderedKeys}::text[]) AS name_key,
             generate_subscripts(${orderedKeys}::text[], 1) AS ord
    ) v
    WHERE d.name_key = v.name_key AND d.verdict = 'like'`;
}

export async function savePreferences(
  prefs: Partial<Preferences>,
): Promise<Preferences> {
  const current = await getPreferences();
  const next = { ...current, ...prefs };
  await sql`
    UPDATE ${t("preferences")} SET
      origins         = ${sql.json(next.origins)}::jsonb,
      similar_new_mix = ${next.similar_new_mix},
      origin_mode     = ${next.origin_mode},
      surname         = ${next.surname},
      topup_threshold = ${next.topup_threshold}
    WHERE id = 1`;
  return next;
}

export function needsTopUp(
  depth: { girl: number; boy: number },
  threshold: number,
) {
  return depth.girl <= threshold || depth.boy <= threshold;
}

export { queueDepth };
