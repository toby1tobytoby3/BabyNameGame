/**
 * Applies db/*.sql in order. Run with: npm run db:push
 * Idempotent — every statement is CREATE ... IF NOT EXISTS.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Fill it in in .env.local first.");
  process.exit(1);
}

const sql = postgres(url, { prepare: false, max: 1 });

const dir = join(process.cwd(), "db");
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

try {
  for (const file of files) {
    process.stdout.write(`applying ${file} … `);
    await sql.unsafe(readFileSync(join(dir, file), "utf8")).simple();
    console.log("ok");
  }
  const [{ n }] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM information_schema.tables
    WHERE table_schema = ${process.env.DB_SCHEMA ?? "babynames"}`;
  console.log(`\n${n} tables present in schema "${process.env.DB_SCHEMA ?? "babynames"}".`);
} catch (err) {
  console.error("\nMigration failed:", err);
  process.exitCode = 1;
} finally {
  await sql.end();
}
