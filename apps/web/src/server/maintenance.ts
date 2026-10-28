import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq, workspaceSettings, type Db } from "@iclabs/db";
import type { Actor } from "@iclabs/core";
import { assertCan, audit } from "./audit";
import { db } from "./db";
import { env } from "./env";

/**
 * Maintenance mode: while it's on, candidates (pages, sign-in, uploads) see a notice instead
 * of the workspace. Team pages keep working. An admin can turn on "testing" at /testing, which
 * lets that one browser use the candidate side as normal.
 */
const KEY = "maintenance";
export const TESTING_COOKIE = "ws_testing";

export type Maintenance = { on: boolean; backBy: string };

export async function maintenance(database: Db = db()): Promise<Maintenance> {
  const [row] = await database
    .select({ value: workspaceSettings.value })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.key, KEY));
  // Never set yet: on, so the release that brings this in is tested before anyone sees it.
  if (!row) return { on: true, backBy: "6 pm IST" };
  const v = row.value as Partial<Maintenance>;
  return { on: v.on === true, backBy: v.backBy || "6 pm IST" };
}

export async function setMaintenance(database: Db, actor: Actor, next: Maintenance) {
  assertCan(actor, "manage", { type: "team_settings" });
  const by = actor.kind === "team" ? actor.userId : null;
  await database
    .insert(workspaceSettings)
    .values({ key: KEY, value: next, updatedBy: by })
    .onConflictDoUpdate({
      target: workspaceSettings.key,
      set: { value: next, updatedBy: by, updatedAt: new Date() },
    });
  await audit(database, {
    actorUserId: by,
    action: next.on ? "maintenance_on" : "maintenance_off",
    entity: "settings",
    entityId: KEY,
    after: next,
  });
}

/** The testing cookie's value: only the server can make it. */
export function testingToken(): string {
  return createHmac("sha256", env().BETTER_AUTH_SECRET)
    .update("maintenance-testing:v1")
    .digest("hex");
}

export async function isTesting(): Promise<boolean> {
  const v = (await cookies()).get(TESTING_COOKIE)?.value;
  if (!v) return false;
  const want = Buffer.from(testingToken());
  const got = Buffer.from(v);
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Null when the candidate side is open to this browser; otherwise the notice to show. */
export async function maintenanceBlock(): Promise<Maintenance | null> {
  // The cookie first: it marks the page as per-request, so nothing is read at build time.
  const testing = await isTesting();
  const m = await maintenance();
  if (!m.on || testing) return null;
  return m;
}

/** For candidate pages and actions: sends everyone but testers to the notice. */
export async function redirectIfMaintenance(): Promise<void> {
  if (await maintenanceBlock()) redirect("/maintenance");
}
