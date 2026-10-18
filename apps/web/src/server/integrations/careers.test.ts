import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, applications, users, type Db } from "@iclabs/db";
import { createTestDb } from "@iclabs/db/testing";
import { createNode, emptyWorkflow, type WorkflowConfig } from "@iclabs/core";
import { teamActor } from "../../test/fixtures";
import {
  createCycle,
  createRole,
  getBuilderData,
  getCycleDetail,
  publishDraft,
  saveDraft,
  setCycleStatus,
} from "../hiring/structure";
import {
  inviteShortlisted,
  parseRoleMap,
  shortlistSchema,
  signCareersRequest,
  verifyCareersRequest,
} from "./careers";

let db: Db;
let close: () => Promise<void>;
const queueEmail = vi.fn(async () => "email-id");
const deps = (roleMap?: string) => ({
  queueEmail,
  roleMap,
  loginUrl: "https://workspace.isocodelabs.com/login",
});
const SECRET = "s".repeat(40);

function flow(): WorkflowConfig {
  const form = createNode("form", { id: "details", title: "Details" });
  return {
    ...emptyWorkflow(),
    nodes: [form],
    edges: [{ id: "1", from: "details", to: "END_COMPLETE", priority: 0, when: { always: true } }],
  };
}

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const admin = await teamActor(db, "admin");
  const role = await createRole(db, admin, { title: "SDE Intern", slug: "sde" });
  const cycle = await createCycle(db, admin, { roleId: role.id, name: "Cycle 1" });
  await setCycleStatus(db, admin, { cycleId: cycle.id, status: "open" });
  const { tracks } = await getCycleDetail(db, admin, cycle.id);
  const data = await getBuilderData(db, admin, tracks[0]!.id);
  await saveDraft(db, admin, {
    workflowId: tracks[0]!.id,
    versionId: data.draft!.id,
    config: flow(),
    etag: data.draft!.etag,
  });
  await publishDraft(db, admin, { workflowId: tracks[0]!.id, versionId: data.draft!.id });
});
afterAll(() => close());

const input = (over: Record<string, unknown> = {}) =>
  shortlistSchema.parse({
    applicationId: 42,
    name: "Riya Shah",
    email: "riya@example.com",
    roleKey: "software-engineering-intern",
    roleTitle: "SDE Intern",
    linkedin: "not a url",
    ...over,
  });

describe("request signing", () => {
  const body = '{"candidates":[]}';
  const now = Date.now();
  const ts = String(now);

  it("accepts a fresh, correctly signed request", () => {
    const signature = signCareersRequest(SECRET, ts, body);
    expect(verifyCareersRequest(SECRET, { timestamp: ts, signature }, body, now)).toBe(true);
  });

  it("refuses a wrong secret, an edited body, or an old timestamp", () => {
    const signature = signCareersRequest(SECRET, ts, body);
    expect(verifyCareersRequest("x".repeat(40), { timestamp: ts, signature }, body, now)).toBe(false);
    expect(verifyCareersRequest(SECRET, { timestamp: ts, signature }, body + " ", now)).toBe(false);
    expect(
      verifyCareersRequest(SECRET, { timestamp: ts, signature }, body, now + 6 * 60_000),
    ).toBe(false);
    expect(verifyCareersRequest(SECRET, { timestamp: null, signature }, body, now)).toBe(false);
  });
});

describe("role mapping", () => {
  it("parses careersKey=slug pairs", () => {
    expect([...parseRoleMap(" A=sde , b = pm,broken ")]).toEqual([
      ["a", "sde"],
      ["b", "pm"],
    ]);
  });
});

describe("inviting a shortlisted applicant", () => {
  it("creates the account and queues the welcome email, matching the role by title", async () => {
    queueEmail.mockClear();
    const result = await inviteShortlisted(db, input(), deps());
    expect(result).toEqual({ status: "invited", role: "SDE Intern" });
    expect(queueEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "riya@example.com", templateKey: "welcome" }),
    );
    const [u] = await db.select().from(users).where(eq(users.email, "riya@example.com"));
    expect(u?.kind).toBe("candidate");
  });

  it("is safe to send twice", async () => {
    queueEmail.mockClear();
    expect(await inviteShortlisted(db, input(), deps())).toEqual({
      status: "already",
      role: "SDE Intern",
    });
    expect(queueEmail).not.toHaveBeenCalled();
    expect(await db.select().from(applications)).toHaveLength(1);
  });

  it("uses CAREERS_ROLE_MAP when the title differs", async () => {
    const result = await inviteShortlisted(
      db,
      input({ email: "arjun@example.com", roleTitle: "Software Engineering Intern" }),
      deps("software-engineering-intern=sde"),
    );
    expect(result.status).toBe("invited");
  });

  it("prefers the exact slug over an older role with the same title", async () => {
    const admin = await teamActor(db, "admin");
    await createRole(db, admin, { title: "Software Engineering Intern", slug: "old-swe" });
    const { resolveRoleSlug } = await import("./careers");
    expect(
      await resolveRoleSlug(db, { roleKey: "sde", roleTitle: "Software Engineering Intern" }),
    ).toBe("sde");
  });

  it("explains an unknown role instead of failing silently", async () => {
    const result = await inviteShortlisted(
      db,
      input({ email: "x@example.com", roleKey: "designer", roleTitle: "Designer" }),
      deps(),
    );
    expect(result).toMatchObject({ status: "error" });
    expect("reason" in result && result.reason).toMatch(/No workspace role matches "Designer"/);
  });
});
