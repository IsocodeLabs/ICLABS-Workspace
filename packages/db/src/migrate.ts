import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { connectionOptions } from "./index";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const conn = connectionOptions(url);
const client = postgres(conn.url, { max: 1, ...(conn.host ? { host: conn.host } : {}) });
await migrate(drizzle(client), {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
});
console.log("Migrations applied");
await client.end();
