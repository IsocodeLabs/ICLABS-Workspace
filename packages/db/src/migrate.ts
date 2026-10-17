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

// First deploy: put the initial admin on the team allow-list (idempotent).
const admin = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
if (admin) {
  await client`insert into team_members (id, email, role) values (${`bootstrap_${admin}`}, ${admin}, 'admin') on conflict (email) do nothing`;
  console.log(`Admin ensured: ${admin}`);
}
await client.end();
