/**
 * Idempotent: makes sure each role on careers.isocodelabs.com exists in the workspace with the
 * same slug, an open round and a published track, so "Invite to workspace" on the careers
 * screening desk has somewhere to land. PM and SDE get their full process once per track; see
 * src/server/hiring/setup-roles.ts for exactly what that does.
 *
 * Runs after migrations in the migrate job; by hand: `pnpm --filter @iclabs/web setup-roles`
 */
import { createDb } from "@iclabs/db";
import { inviterActor } from "../src/server/integrations/careers";
import { setupCareersRoles } from "../src/server/hiring/setup-roles";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const db = createDb(url, { max: 1 });
const actor = await inviterActor(db);
if (!actor || actor.kind !== "team") throw new Error("No active admin to act as");
await setupCareersRoles(db, actor);
console.log("Careers roles ready");
process.exit(0);
