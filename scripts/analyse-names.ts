/**
 * Analyse every name the app knows and store the traits.
 * Run with: npm run traits:push
 *
 * Idempotent and safe to re-run: rows are rewritten only when the analyser
 * version or the spelling changed, so a second run writes nothing. Run it after
 * `npm run db:push` on a new database, and after any change to lib/analyse.ts
 * (which should also bump ANALYSER_VERSION).
 */
import { ANALYSER_VERSION } from "../lib/analyse.ts";
import { sql, t } from "../lib/db.ts";
import { backfillTraits } from "../lib/traits.ts";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Fill it in in .env.local first.");
  process.exit(1);
}

try {
  process.stdout.write(`analysing with version ${ANALYSER_VERSION} … `);
  const { library, database, written } = await backfillTraits();
  console.log("ok");
  console.log(`  library names:  ${library}`);
  console.log(`  database names: ${database}`);
  console.log(`  rows written:   ${written}`);

  // Anything decided or queued that still has no traits is a bug, not a
  // shortfall — every one of those names went through the same analyser.
  const [gap] = await sql<{ missing: number; stale: number }[]>`
    SELECT
      (SELECT count(*)::int FROM (
        SELECT name_key FROM ${t("decisions")}
        UNION SELECT name_key FROM ${t("queue")}
      ) n WHERE NOT EXISTS (
        SELECT 1 FROM ${t("name_traits")} x WHERE x.name_key = n.name_key
      )) AS missing,
      (SELECT count(*)::int FROM ${t("name_traits")}
        WHERE analysed_with <> ${ANALYSER_VERSION}) AS stale`;
  console.log(`  unanalysed:     ${gap.missing}`);
  console.log(`  stale version:  ${gap.stale}`);
  if (gap.missing > 0 || gap.stale > 0) process.exitCode = 1;
} catch (err) {
  console.error("\nAnalysis failed:", err);
  process.exitCode = 1;
} finally {
  await sql.end();
}
