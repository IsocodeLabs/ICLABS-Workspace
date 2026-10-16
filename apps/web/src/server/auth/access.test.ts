import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  eq,
  applications,
  cycles,
  roleAssignments,
  roles,
  teamMembers,
  users,
  workflows,
  type Db,
} from "@iclabs/db";
import { createTestDb } from "@iclabs/db/testing";
import { loadActor } from "./actor";
import { createCandidateAccount } from "./candidate-auth";
import { allowSession, allowTeamSignUp } from "./team-access";
import { listApplicationsForActor } from "../applications";

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(() => close());

describe("team allow-list", () => {
  it("only allows Google sign-up for active allow-listed @isocodelabs.com emails", async () => {
    await db.insert(teamMembers).values([
      { email: "lead@isocodelabs.com", role: "admin" },
      { email: "gone@isocodelabs.com", role: "reviewer", active: false },
    ]);
    expect(await allowTeamSignUp(db, "Lead@IsocodeLabs.com", "isocodelabs.com")).toBe(true);
    expect(await allowTeamSignUp(db, "gone@isocodelabs.com", "isocodelabs.com")).toBe(false);
    expect(await allowTeamSignUp(db, "stranger@isocodelabs.com", "isocodelabs.com")).toBe(false);
    expect(await allowTeamSignUp(db, "lead@gmail.com", "isocodelabs.com")).toBe(false);
  });

  it("links the allow-list on first session and blocks it once the member is deactivated", async () => {
    const [u] = await db
      .insert(users)
      .values({ email: "lead@isocodelabs.com", name: "Lead", kind: "team" })
      .returning();
    expect(await allowSession(db, u!.id, "isocodelabs.com")).toBe(true);
    const [member] = await db
      .select()
      .from(teamMembers)
      .where(eq(teamMembers.email, "lead@isocodelabs.com"));
    expect(member!.userId).toBe(u!.id);

    await db.update(teamMembers).set({ active: false }).where(eq(teamMembers.id, member!.id));
    expect(await allowSession(db, u!.id, "isocodelabs.com")).toBe(false);
  });

  it("refuses sessions for disabled candidates", async () => {
    const { userId } = await createCandidateAccount(db, { email: "off@example.com", name: "Off" });
    expect(await allowSession(db, userId, "isocodelabs.com")).toBe(true);
    await db.update(users).set({ status: "disabled" }).where(eq(users.id, userId));
    expect(await allowSession(db, userId, "isocodelabs.com")).toBe(false);
  });
});

describe("role-scoped visibility", () => {
  it("shows each candidate only their own applications, and a hiring manager only their roles", async () => {
    const [sde] = await db.insert(roles).values({ title: "SDE Intern", slug: "sde" }).returning();
    const [pm] = await db.insert(roles).values({ title: "PM Intern", slug: "pm" }).returning();
    const track = async (roleId: string) => {
      const [cycle] = await db.insert(cycles).values({ roleId, name: "Winter 26" }).returning();
      const [wf] = await db
        .insert(workflows)
        .values({ cycleId: cycle!.id, name: "Main" })
        .returning();
      return wf!.id;
    };
    const sdeTrack = await track(sde!.id);
    const pmTrack = await track(pm!.id);

    const a = await createCandidateAccount(db, { email: "a@example.com", name: "A" });
    const b = await createCandidateAccount(db, { email: "b@example.com", name: "B" });
    await db.insert(applications).values([
      { candidateId: a.candidateId, roleId: sde!.id, workflowId: sdeTrack },
      { candidateId: a.candidateId, roleId: pm!.id, workflowId: pmTrack },
      { candidateId: b.candidateId, roleId: pm!.id, workflowId: pmTrack },
    ]);

    const actorA = (await loadActor(db, a.userId))!;
    const actorB = (await loadActor(db, b.userId))!;
    expect((await listApplicationsForActor(db, actorA)).map((x) => x.roleTitle).sort()).toEqual([
      "PM Intern",
      "SDE Intern",
    ]);
    expect((await listApplicationsForActor(db, actorB)).map((x) => x.roleTitle)).toEqual([
      "PM Intern",
    ]);

    const [hmUser] = await db
      .insert(users)
      .values({ email: "hm@isocodelabs.com", name: "HM", kind: "team" })
      .returning();
    const [hm] = await db
      .insert(teamMembers)
      .values({ email: "hm@isocodelabs.com", role: "hiring_manager", userId: hmUser!.id })
      .returning();
    await db
      .insert(roleAssignments)
      .values({ teamMemberId: hm!.id, scope: "role", scopeId: sde!.id });
    const hmActor = (await loadActor(db, hmUser!.id))!;
    const seen = await listApplicationsForActor(db, hmActor);
    expect(seen.map((x) => x.roleTitle)).toEqual(["SDE Intern"]);
  });
});
