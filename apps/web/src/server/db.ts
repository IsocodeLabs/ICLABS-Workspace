import "server-only";
import { createDb, type Db } from "@iclabs/db";
import { env } from "./env";

const globalForDb = globalThis as unknown as { db?: Db };

/** One connection pool per server instance (and per hot reload in dev). */
export function db(): Db {
  globalForDb.db ??= createDb(env().DATABASE_URL, { max: env().DATABASE_POOL_MAX });
  return globalForDb.db;
}
