import "server-only";
import { sql, type Db } from "@iclabs/db";
import { db } from "../db";
import { inviterActor } from "../integrations/careers";
import { setupCareersRoles } from "./setup-roles";

/** Any fixed number: one Postgres advisory lock shared by every server instance. */
const LOCK_KEY = 724_001;

/**
 * Runs the careers-role setup when a server starts, so a deploy installs the PM/SDE processes
 * without depending on the migrate job's command. Idempotent (see setupCareersRoles); one
 * instance at a time does the work and the rest skip; a failure is logged, never fatal.
 */
export async function ensureCareersRoles() {
  try {
    await db().transaction(async (tx) => {
      const rows = (await tx.execute(
        sql`select pg_try_advisory_xact_lock(${LOCK_KEY}) as locked`,
      )) as unknown as {
        locked: boolean;
      }[];
      const row = rows[0];
      if (!row?.locked) return;
      const actor = await inviterActor(tx as unknown as Db);
      if (!actor || actor.kind !== "team") {
        console.error("[setup-roles] skipped: no active admin who has signed in to act as");
        return;
      }
      await setupCareersRoles(tx as unknown as Db, actor, (msg) =>
        console.log(`[setup-roles] ${msg}`),
      );
    });
  } catch (err) {
    console.error("[setup-roles] failed", err instanceof Error ? err.stack : err);
  }
}
