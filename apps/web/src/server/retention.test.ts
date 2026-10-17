import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, applications, auditLog, candidates, cycles, emailMessages, files, users, workflows, type Db } from "@iclabs/db";
import { createTestDb } from "@iclabs/db/testing";
import { teamActor } from "../test/fixtures";
import { audit } from "./audit";
import { createCandidateAccount } from "./auth/candidate-auth";
import { createCycle, createRole, getCycleDetail } from "./hiring/structure";
import { eraseCandidateOnRequest, purgeExpired } from "./retention";
import type { FileStore } from "./storage";

let db: Db;
let close: () => Promise<void>;
let admin: Awaited<ReturnType<typeof teamActor>>;
const removed: string[] = [];
const store: FileStore = {
  uploadUrl: async () => ({ url: "", headers: {} }),
  downloadUrl: async () => "",
  size: async () => null,
  remove: async (k) => void removed.push(k),
};
const now = new Date("2027-12-01T00:00:00Z");

async function trackIn(cycleState: { status: "open" | "closed"; closesAt: Date | null }) {
  const role = await createRole(db, admin, { title: "BDI", slug: `bdi-${Math.random().toString(36).slice(2)}` });
  const cycle = await createCycle(db, admin, { roleId: role.id, name: "C" });
  await db.update(cycles).set(cycleState).where(eq(cycles.id, cycle.id));
  const { tracks } = await getCycleDetail(db, admin, cycle.id);
  return { roleId: role.id, workflowId: tracks[0]!.id };
}

async function candidateIn(...tracks: { roleId: string; workflowId: string }[]) {
  const c = await createCandidateAccount(db, { email: `c${Math.random()}@x.com`, name: "Meera" });
  for (const t of tracks) await db.insert(applications).values({ candidateId: c.candidateId, ...t });
  await db.insert(files).values({ ownerCandidateId: c.candidateId, objectKey: `k/${c.candidateId}`, filename: "cv.pdf", mime: "application/pdf", size: 1 });
  await db.insert(emailMessages).values({ toEmail: "meera@x.com", templateKey: "welcome", userId: c.userId, vars: {} });
  await audit(db, { actorUserId: c.userId, action: "consent_given", entity: "candidate", entityId: c.candidateId });
  return c;
}

const exists = async (candidateId: string) => (await db.select().from(candidates).where(eq(candidates.id, candidateId))).length > 0;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  admin = await teamActor(db, "admin");
});
afterAll(() => close());

describe("retention", () => {
  it("erases candidates only when every cycle they're in closed over 12 months ago", async () => {
    const old = await trackIn({ status: "closed", closesAt: new Date("2026-06-01") });
    const recent = await trackIn({ status: "closed", closesAt: new Date("2027-06-01") });
    const open = await trackIn({ status: "open", closesAt: null });
    const gone = await candidateIn(old);
    const keptRecent = await candidateIn(recent);
    const keptMixed = await candidateIn(old, open);

    expect(await purgeExpired(db, store, now)).toBe(1);
    expect(await exists(gone.candidateId)).toBe(false);
    expect(await exists(keptRecent.candidateId)).toBe(true);
    expect(await exists(keptMixed.candidateId)).toBe(true);
    expect(removed).toContain(`k/${gone.candidateId}`);
    expect(await db.select().from(users).where(eq(users.id, gone.userId))).toEqual([]);
    expect(await db.select().from(emailMessages).where(eq(emailMessages.userId, gone.userId))).toEqual([]);
    // Their audit entries stay, without the link to the deleted account.
    const trail = await db.select().from(auditLog).where(eq(auditLog.entityId, gone.candidateId));
    expect(trail.map((t) => t.action).sort()).toEqual(["candidate_erased", "consent_given"]);
    expect(trail.every((t) => t.actorUserId === null)).toBe(true);
  });

  it("admins can erase on request; nobody else", async () => {
    const t = await trackIn({ status: "open", closesAt: null });
    const c = await candidateIn(t);
    const hm = await teamActor(db, "hiring_manager", { roleIds: [t.roleId] });
    await expect(eraseCandidateOnRequest(db, store, hm, c.candidateId)).rejects.toThrow();
    expect(await eraseCandidateOnRequest(db, store, admin, c.candidateId)).toBe(true);
    expect(await exists(c.candidateId)).toBe(false);
    expect(await db.select().from(workflows).where(eq(workflows.id, t.workflowId))).toHaveLength(1);
  });
});
