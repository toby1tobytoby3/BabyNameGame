import postgres from "postgres";

/**
 * Schema the app's tables live in. Defaults to `babynames` so the tables can
 * sit inside an existing Supabase project without colliding with anything in
 * `public`. Sanitised because it is interpolated as an identifier.
 */
export const SCHEMA = (process.env.DB_SCHEMA ?? "babynames").replace(
  /[^a-z0-9_]/gi,
  "",
);

const globalForDb = globalThis as unknown as { _sql?: postgres.Sql };

function getSql(): postgres.Sql {
  if (globalForDb._sql) return globalForDb._sql;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set — add it to .env.local (Supabase → Project " +
        "Settings → Database → Connection string → Transaction pooler).",
    );
  }

  const instance = postgres(url, {
    // Supabase's transaction pooler does not support prepared statements.
    // Harmless on a direct/session connection, so always off.
    prepare: false,
    max: 5,
    idle_timeout: 20,
  });
  globalForDb._sql = instance;
  return instance;
}

/**
 * Lazily-connected client. `next build` evaluates route modules to collect page
 * data, so constructing this eagerly would make a missing DATABASE_URL a *build*
 * failure rather than a runtime one. The proxy defers everything to first use.
 */
export const sql = new Proxy(function () {} as unknown as postgres.Sql, {
  apply(_target, _thisArg, args) {
    return (getSql() as unknown as (...a: unknown[]) => unknown)(...args);
  },
  get(_target, prop) {
    const instance = getSql();
    const value = Reflect.get(instance, prop);
    return typeof value === "function" ? value.bind(instance) : value;
  },
}) as postgres.Sql;

/** Either the pooled client or a transaction handle from sql.begin(). */
export type SqlHandle = postgres.Sql | postgres.TransactionSql;

/**
 * Schema-qualified table reference, e.g. sql`select * from ${t("decisions")}`.
 * Pass the transaction handle inside sql.begin(): q(tx, "decisions").
 */
export const q = (
  s: postgres.Sql | postgres.TransactionSql,
  table: string,
) => {
  // Sql and TransactionSql expose the same tagged-template surface but are not
  // mutually assignable in the type defs.
  const h = s as postgres.Sql;
  return h`${h(SCHEMA)}.${h(table)}`;
};

export const t = (table: string) => q(sql, table);
