import { analyse, ANALYSER_VERSION } from "./analyse.ts";
import { q, sql, t, type SqlHandle } from "./db.ts";
import { LIBRARY } from "./library.ts";

/** A name to analyse. Origin is only a pronunciation hint. */
export interface Analysable {
  name_key: string;
  display: string;
  origin?: string | null;
}

/**
 * Analyse and store. Idempotent, and safe to call with names already present:
 * a row is rewritten only when the analyser version changed or the display
 * string did, so the common case is a no-op that touches nothing.
 *
 * Pass the transaction handle when inserting names inside one, so a name and
 * its traits arrive together or not at all.
 */
export async function upsertTraits(
  names: Analysable[],
  h: SqlHandle = sql,
): Promise<number> {
  if (!names.length) return 0;

  // Dedupe by key: a top-up chunk can carry the same name twice, and
  // ON CONFLICT cannot see rows inserted by its own statement.
  const byKey = new Map<string, Analysable>();
  for (const n of names) if (n.name_key) byKey.set(n.name_key, n);

  const payload = [...byKey.values()].map((n) => {
    const tr = analyse(n.display, n.origin ?? null);
    return {
      name_key: n.name_key,
      display: n.display,
      letters: tr.letters,
      syllables: tr.syllables,
      onset: tr.onset,
      ending: tr.ending,
      hardness: tr.hardness,
      softness: tr.softness,
      brightness: tr.brightness,
      vowel_ratio: tr.vowelRatio,
      has_double: tr.hasDouble,
      has_cluster: tr.hasCluster,
      initial: tr.initial,
      analysed_with: ANALYSER_VERSION,
    };
  });

  // One JSON document shredded into rows by Postgres, typed at the boundary —
  // the same shape insertCandidates uses, and for the same reason.
  const s = h as typeof sql;
  const written = await s<{ name_key: string }[]>`
    INSERT INTO ${q(h, "name_traits")} (
      name_key, display, letters, syllables, onset, ending,
      hardness, softness, brightness, vowel_ratio,
      has_double, has_cluster, initial, analysed_with
    )
    SELECT name_key, display, letters, syllables, onset, ending,
           hardness, softness, brightness, vowel_ratio,
           has_double, has_cluster, initial, analysed_with
    FROM jsonb_to_recordset(${sql.json(payload)}::jsonb) AS x(
      name_key TEXT, display TEXT, letters SMALLINT, syllables SMALLINT,
      onset TEXT, ending TEXT, hardness REAL, softness REAL, brightness REAL,
      vowel_ratio REAL, has_double BOOLEAN, has_cluster BOOLEAN,
      initial TEXT, analysed_with SMALLINT
    )
    ON CONFLICT (name_key) DO UPDATE SET
      display = EXCLUDED.display, letters = EXCLUDED.letters,
      syllables = EXCLUDED.syllables, onset = EXCLUDED.onset,
      ending = EXCLUDED.ending, hardness = EXCLUDED.hardness,
      softness = EXCLUDED.softness, brightness = EXCLUDED.brightness,
      vowel_ratio = EXCLUDED.vowel_ratio, has_double = EXCLUDED.has_double,
      has_cluster = EXCLUDED.has_cluster, initial = EXCLUDED.initial,
      analysed_with = EXCLUDED.analysed_with, analysed_at = now()
    -- Rewrite only what actually changed, so a re-run is cheap and
    -- analysed_at stays meaningful. Comparing every column, rather than
    -- trusting the version number, makes the cache self-healing: editing the
    -- analyser and forgetting to bump ANALYSER_VERSION still refreshes the
    -- rows whose values moved. (name_traits is the implicit alias for the
    -- conflict target, whatever schema it lives in.)
    WHERE (name_traits.analysed_with, name_traits.display, name_traits.letters,
           name_traits.syllables, name_traits.onset, name_traits.ending,
           name_traits.hardness, name_traits.softness, name_traits.brightness,
           name_traits.vowel_ratio, name_traits.has_double,
           name_traits.has_cluster, name_traits.initial)
      IS DISTINCT FROM
          (EXCLUDED.analysed_with, EXCLUDED.display, EXCLUDED.letters,
           EXCLUDED.syllables, EXCLUDED.onset, EXCLUDED.ending,
           EXCLUDED.hardness, EXCLUDED.softness, EXCLUDED.brightness,
           EXCLUDED.vowel_ratio, EXCLUDED.has_double,
           EXCLUDED.has_cluster, EXCLUDED.initial)
    RETURNING name_key`;
  return written.length;
}

/**
 * Analyse and store, but never at the cost of the write that is actually
 * happening. Traits are derived data — a swipe, a top-up or a hand-added name
 * must still land if this fails.
 *
 * The savepoint is the point: inside a transaction, a failed statement poisons
 * the whole transaction, so catching the error in JS is not enough — the COMMIT
 * would still fail. A savepoint rolls back just this write. That matters most
 * on the deploy where the code is live but `npm run db:push` has not run yet:
 * without it, a missing name_traits table would stop the queue refilling.
 */
export async function upsertTraitsBestEffort(
  names: Analysable[],
  h: SqlHandle,
): Promise<void> {
  const tx = h as { savepoint?: (cb: (s: SqlHandle) => Promise<unknown>) => Promise<unknown> };
  try {
    if (typeof tx.savepoint === "function") {
      await tx.savepoint(async (sp) => upsertTraits(names, sp));
    } else {
      await upsertTraits(names, h);
    }
  } catch (err) {
    console.error("[traits] could not store name traits", err);
  }
}

/**
 * Analyse everything the app knows about: the bundled library, plus every name
 * that has reached the database by any route (swiped, generated, hand-added).
 * Idempotent — this is what `npm run traits:push` runs.
 */
export async function backfillTraits(): Promise<{
  library: number;
  database: number;
  written: number;
}> {
  const rows = await sql<{ name_key: string; display: string; origin: string | null }[]>`
    SELECT name_key, display, origin FROM ${t("decisions")}
    UNION
    SELECT name_key, display, origin FROM ${t("queue")}`;

  const written =
    (await upsertTraits(LIBRARY)) + (await upsertTraits(rows));

  return { library: LIBRARY.length, database: rows.length, written };
}
