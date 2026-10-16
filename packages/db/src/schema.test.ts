import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "./testing";
import { applications, candidates, cycles, roles, users, workflows } from "./schema";
import type { Db } from "./index";

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(() => close());

describe("schema v1", () => {
  it("applies migrations and round-trips a candidate with an application", async () => {
    const [user] = await db
      .insert(users)
      .values({ name: "Riya", email: "riya@example.com" })
      .returning();
    const [candidate] = await db
      .insert(candidates)
      .values({ userId: user!.id, name: "Riya", skills: ["sql"] })
      .returning();
    const [role] = await db.insert(roles).values({ title: "SDE Intern", slug: "sde" }).returning();
    const [cycle] = await db
      .insert(cycles)
      .values({ roleId: role!.id, name: "Winter 26" })
      .returning();
    const [workflow] = await db
      .insert(workflows)
      .values({ cycleId: cycle!.id, name: "Backend" })
      .returning();
    await db
      .insert(applications)
      .values({ candidateId: candidate!.id, roleId: role!.id, workflowId: workflow!.id });

    const rows = await db
      .select()
      .from(applications)
      .where(eq(applications.candidateId, candidate!.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("active");
    expect(rows[0]!.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("rejects a second application to the same track for one candidate", async () => {
    const [app] = await db.select().from(applications);
    await expect(
      db.insert(applications).values({
        candidateId: app!.candidateId,
        roleId: app!.roleId,
        workflowId: app!.workflowId,
      }),
    ).rejects.toThrow();
  });

  it("new users default to candidate, active, no forced password change", async () => {
    const [u] = await db.insert(users).values({ name: "X", email: "x@example.com" }).returning();
    expect(u).toMatchObject({
      kind: "candidate",
      status: "active",
      mustChangePassword: false,
      failedLoginCount: 0,
    });
  });
});
