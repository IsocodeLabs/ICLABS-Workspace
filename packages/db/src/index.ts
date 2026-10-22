import { drizzle } from "drizzle-orm/postgres-js";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";
import * as schema from "./schema";

export { schema };
export * from "./schema";
// Query helpers come from here so every package shares this package's single drizzle-orm copy.
export {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";

/** Any Postgres-backed Drizzle instance (postgres.js in the app, PGlite in tests). */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/**
 * Cloud Run reaches Cloud SQL over a Unix socket: `postgres://user:pass@localhost/db?host=/cloudsql/<instance>`.
 * postgres.js ignores `host` in the query string (and would send it to the server), so lift it out.
 */
export function connectionOptions(url: string): { url: string; host?: string } {
  const parsed = new URL(url);
  const host = parsed.searchParams.get("host");
  if (!host) return { url };
  parsed.searchParams.delete("host");
  return { url: parsed.toString(), host };
}

export function createDb(url: string, opts: { max?: number } = {}): Db {
  const conn = connectionOptions(url);
  const client = postgres(conn.url, {
    max: opts.max ?? 10,
    prepare: false,
    ...(conn.host ? { host: conn.host } : {}),
  });
  return drizzle(client, { schema });
}
