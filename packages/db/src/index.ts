import { drizzle } from "drizzle-orm/postgres-js";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";
import * as schema from "./schema";

export { schema };
export * from "./schema";
// Query helpers come from here so every package shares this package's single drizzle-orm copy.
export { and, asc, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";

/** Any Postgres-backed Drizzle instance (postgres.js in the app, PGlite in tests). */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export function createDb(url: string): Db {
  const client = postgres(url, { max: 10, prepare: false });
  return drizzle(client, { schema });
}
