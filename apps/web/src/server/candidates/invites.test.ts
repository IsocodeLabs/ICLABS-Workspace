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
  inviteCandidates,
  parseInviteCsv,
  previewInvites,
  resendInvite,
  revokeApplication,
} from "./invites";
import { signInCandidate } from "../auth/candidate-auth";
import { ForbiddenError } from "../audit";

let db: Db;
let close: () => Promise<void>;
let admin: Awaited<ReturnType<typeof teamActor>>;
const queueEmail = vi.fn(async () => "email-id");

function process(): WorkflowConfig {
  const form = createNode("form", { id: "details", title: "Details" });
  const interview = createNode("interview", { id: "int" });
  interview.config.interviewerPool = ["x"];
  return {
    ...emptyWorkflow(),
    nodes: [form, interview],
    edges: [
      { id: "1", from: "details", to: "int", priority: 0, when: { always: true } },
      { id: "2", from: "int", to: "END_COMPLETE", priority: 0, when: { always: true } },
    ],
  };
}

async function openRole(slug: string, title: string, publish = true) {
  const role = await createRole(db, admin, { title, slug });
  const cycle = await createCycle(db, admin, { roleId: role.id, name: "Cycle 1" });
  await setCycleStatus(db, admin, { cycleId: cycle.id, status: "open" });
  const { tracks } = await getCycleDetail(db, admin, cycle.id);
  if (publish) {
    const data = await getBuilderData(db, admin, tracks[0]!.id);
    await saveDraft(db, admin, {
      workflowId: tracks[0]!.id,
      versionId: data.draft!.id,
      config: process(),
      etag: data.draft!.etag,
    });
    await publishDraft(db, admin, { workflowId: tracks[0]!.id, versionId: data.draft!.id });
  }
  return role;
}

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  admin = await teamActor(db, "admin");
  await openRole("sde", "SDE Intern");
  await openRole("pm", "PM Intern");
  await openRole("bdi", "Business Development Intern", false);
});
afterAll(() => close());

const deps = () => ({ queueEmail, loginUrl: "https://workspace.isocodelabs.com/login" });

describe("CSV parsing", () => {
  it("maps common header names and drops unknown columns", () => {
    const { rows } = parseInviteCsv(
      "Full Name,Email,Role Slug,Notes\nRiya Shah, Riya@Example.com ,SDE,ignore me\n",
    );
    expect(rows).toEqual([
      { line: 2, data: { name: "Riya Shah", email: "Riya@Example.com", role: "SDE" } },
    ]);
  });

  it("requires an email column", () => {
    expect(parseInviteCsv("name,role\nA,sde").error).toMatch(/email/);
  });
});

describe("invite preview", () => {
  it("classifies new, duplicate-in-file, invalid and unpublished rows", async () => {
    const { rows } = parseInviteCsv(
      [
        "name,email,role",
        "Riya,riya@example.com,sde",
        "Riya,riya@example.com,sde",
        "Bad,not-an-email,sde",
        "Ana,ana@example.com,marketing",
        "Ben,ben@example.com,bdi",
      ].join("\n"),
    );
    const preview = await previewInvites(db, admin, rows);
    expect(preview.map((p) => p.status.kind)).toEqual([
      "new",
      "duplicate",
      "invalid",
      "invalid",
      "invalid",
    ]);
    expect(preview[3]!.status).toMatchObject({ reason: 'Unknown role "marketing"' });
    expect(preview[4]!.status).toMatchObject({
      reason: expect.stringContaining("isn't published"),
    });
  });

  it("stops hiring managers inviting to roles they don't manage", async () => {
    const hm = await teamActor(db, "hiring_manager");
    const { rows } = parseInviteCsv("name,email,role\nX,x@example.com,sde");
    await expect(previewInvites(db, hm, rows)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("inviting", () => {
  it("creates one account for two roles and sends one welcome email with the password", async () => {
    queueEmail.mockClear();
    const { rows } = parseInviteCsv(
      "name,email,role\nSam Lee,sam@example.com,sde\nSam Lee,sam@example.com,pm",
    );
    const result = await inviteCandidates(db, admin, await previewInvites(db, admin, rows), deps());
    expect(result).toMatchObject({ created: 1, rolesAdded: 0, skipped: 0 });
    expect(queueEmail).toHaveBeenCalledTimes(1);
    const call = (queueEmail.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(call).toMatchObject({
      templateKey: "welcome",
      vars: { roles: "SDE Intern and PM Intern", first_name: "Sam" },
    });
    const temp = (call.secrets as { temp_password: string }).temp_password;

    // The emailed password signs them in, and both applications are pinned to the live process.
    const [user] = await db.select().from(users).where(eq(users.email, "sam@example.com"));
    const apps = await db
      .select()
      .from(applications)
      .where(eq(applications.invitedBy, admin.userId));
    expect(apps.filter((a) => a.currentNodeId === "details")).toHaveLength(2);
    expect(apps.every((a) => a.workflowVersionId)).toBe(true);
    const signIn = await signInCandidate(
      {
        db,
        notifier: { accountLocked: async () => {}, passwordChanged: async () => {} },
        createSession: async () => {},
      },
      { email: "sam@example.com", password: temp, ip: "1.1.1.1" },
    );
    expect(signIn).toEqual({ ok: true, mustChangePassword: true });
    expect(user).toBeDefined();
  });

  it("adds a role to an existing candidate with a role-added email and no new password", async () => {
    queueEmail.mockClear();
    const { rows } = parseInviteCsv("name,email,role\nRiya,riya2@example.com,sde");
    await inviteCandidates(db, admin, await previewInvites(db, admin, rows), deps());
    queueEmail.mockClear();
    const { rows: more } = parseInviteCsv("name,email,role\nRiya,riya2@example.com,pm");
    const preview = await previewInvites(db, admin, more);
    expect(preview[0]!.status.kind).toBe("add_role");
    const result = await inviteCandidates(db, admin, preview, deps());
    expect(result).toMatchObject({ created: 0, rolesAdded: 1 });
    expect(queueEmail).toHaveBeenCalledWith(expect.objectContaining({ templateKey: "role_added" }));
    expect(JSON.stringify(queueEmail.mock.calls)).not.toContain("temp_password");
  });

  it("re-inviting the same role is a duplicate", async () => {
    const { rows } = parseInviteCsv("name,email,role\nRiya,riya2@example.com,sde");
    expect((await previewInvites(db, admin, rows))[0]!.status).toMatchObject({ kind: "duplicate" });
  });

  it("resending an invite issues a new temporary password", async () => {
    queueEmail.mockClear();
    const { rows } = parseInviteCsv("name,email,role\nZed,zed@example.com,sde");
    await inviteCandidates(db, admin, await previewInvites(db, admin, rows), deps());
    const firstTemp = (
      queueEmail.mock.calls[0] as unknown as [{ secrets: { temp_password: string } }]
    )[0].secrets.temp_password;
    const [app] = await db
      .select()
      .from(applications)
      .innerJoin(users, eq(users.email, "zed@example.com"))
      .limit(1);
    const candidateId = (
      await db.select().from(applications).where(eq(applications.id, app!.applications.id))
    )[0]!.candidateId;
    await resendInvite(db, admin, candidateId, deps());
    const secondTemp = (
      queueEmail.mock.calls[1] as unknown as [{ secrets: { temp_password: string } }]
    )[0].secrets.temp_password;
    expect(secondTemp).not.toBe(firstTemp);
  });

  it("revoking a role closes just that application", async () => {
    const [app] = await db.select().from(applications).limit(1);
    await revokeApplication(db, admin, app!.id);
    const [after] = await db.select().from(applications).where(eq(applications.id, app!.id));
    expect(after!.status).toBe("closed_rejected");
  });
});
