import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  eq,
  applications,
  cycles,
  emailMessages,
  stageProgress,
  workflows,
  type Db,
} from "@iclabs/db";
import { createTestDb } from "@iclabs/db/testing";
import { createNode, emptyWorkflow } from "@iclabs/core";
import { teamActor } from "../../test/fixtures";
import { ForbiddenError } from "../audit";
import { createCandidateAccount } from "../auth/candidate-auth";
import { enqueueEmail } from "../email/outbox";
import {
  createCycle,
  createRole,
  getBuilderData,
  getCycleDetail,
  publishDraft,
  saveDraft,
} from "../hiring/structure";
import { announcementRecipients, sendAnnouncement } from "./announce";

let db: Db;
let close: () => Promise<void>;
let admin: Awaited<ReturnType<typeof teamActor>>;
let workflowId: string;
const config = { secretKey: randomBytes(32).toString("base64") };
const deps = {
  queueEmail: (input: Parameters<typeof enqueueEmail>[2]) => enqueueEmail(db, config, input),
  appUrl: (p: string) => `https://w${p}`,
};

/** A candidate currently on `node`, with that step in the given state. */
async function person(
  name: string,
  email: string,
  opts: {
    node: "form" | "task";
    state: "unlocked" | "in_progress" | "submitted" | "missed";
    testMode?: boolean;
    status?: "active" | "needs_decision" | "closed_rejected";
  },
) {
  const [wf] = await db.select().from(workflows).where(eq(workflows.id, workflowId));
  const [cycle] = await db.select().from(cycles).where(eq(cycles.id, wf!.cycleId));
  const c = await createCandidateAccount(db, { email, name });
  const [app] = await db
    .insert(applications)
    .values({
      candidateId: c.candidateId,
      roleId: cycle!.roleId,
      workflowId,
      workflowVersionId: wf!.publishedVersionId,
      currentNodeId: opts.node,
      testMode: opts.testMode ?? false,
      status: opts.status ?? "active",
    })
    .returning();
  await db.insert(stageProgress).values({
    applicationId: app!.id,
    nodeId: opts.node,
    state: opts.state,
    submittedAt: opts.state === "submitted" ? new Date() : null,
  });
  return app!.id;
}

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  admin = await teamActor(db, "admin");
  const role = await createRole(db, admin, { title: "BG Intern", slug: `bg-${Date.now()}` });
  const cycle = await createCycle(db, admin, { roleId: role.id, name: "Oct" });
  const { tracks } = await getCycleDetail(db, admin, cycle.id);
  workflowId = tracks[0]!.id;
  const data = await getBuilderData(db, admin, workflowId);
  const form = createNode("form", { id: "form", title: "Your details" });
  const task = createNode("task", { id: "task", title: "Industry research" });
  task.reviewers!.pool = ["someone"];
  await saveDraft(db, admin, {
    workflowId,
    versionId: data.draft!.id,
    etag: data.draft!.etag,
    config: {
      ...emptyWorkflow(),
      nodes: [form, task],
      edges: [
        { id: "e1", from: "form", to: "task", priority: 0, when: { always: true } },
        { id: "e2", from: "task", to: "END_COMPLETE", priority: 0, when: { always: true } },
      ],
    },
  });
  await publishDraft(db, admin, { workflowId, versionId: data.draft!.id });
  await person("Asha Rao", "asha@example.com", { node: "task", state: "unlocked" });
  await person("Bilal Khan", "bilal@example.com", {
    node: "form",
    state: "missed",
    status: "needs_decision",
  });
  await person("Chitra Iyer", "chitra@example.com", { node: "task", state: "submitted" });
  await person("Test Tester", "tester@example.com", {
    node: "task",
    state: "unlocked",
    testMode: true,
  });
  await person("Gone Away", "gone@example.com", {
    node: "form",
    state: "unlocked",
    status: "closed_rejected",
  });
});
afterAll(() => close());

const last = { nodeId: "task", key: "task_last_extension" } as const;
const prepare = { nodeId: "task", key: "task_prepare" } as const;
const target = (t: typeof last | typeof prepare) => ({ workflowId, ...t });

describe("announcements", () => {
  it("last extension goes to everyone who hasn't submitted the task, even if stuck earlier, and names their step", async () => {
    const r = await announcementRecipients(db, admin, target(last));
    expect(r.map((x) => [x.email, x.stageTitle]).sort()).toEqual([
      ["asha@example.com", "Industry research"],
      ["bilal@example.com", "Your details"],
    ]);
  });

  it("never includes people who submitted the task, test accounts or closed applications", async () => {
    const emails = (await announcementRecipients(db, admin, target(last))).map((x) => x.email);
    for (const left of ["chitra@example.com", "tester@example.com", "gone@example.com"])
      expect(emails).not.toContain(left);
  });

  it("'get ready' goes to people who submitted the step", async () => {
    const r = await announcementRecipients(db, admin, target(prepare));
    expect(r.map((x) => x.email)).toEqual(["chitra@example.com"]);
  });

  it("queues one email each with their own name and step, and a second run sends nothing new", async () => {
    expect(await sendAnnouncement(db, deps, admin, target(last))).toEqual({ sent: 2, skipped: 0 });
    const rows = await db
      .select()
      .from(emailMessages)
      .where(eq(emailMessages.templateKey, "task_last_extension"));
    expect(rows.map((m) => m.toEmail).sort()).toEqual(["asha@example.com", "bilal@example.com"]);
    expect(rows.find((m) => m.toEmail === "bilal@example.com")!.vars).toMatchObject({
      first_name: "Bilal",
      role: "BG Intern",
      stage: "Your details",
    });
    expect(await sendAnnouncement(db, deps, admin, target(last))).toEqual({
      sent: 0,
      skipped: 2,
    });
  });

  it("only admins can look up or send", async () => {
    const hm = await teamActor(db, "hiring_manager");
    await expect(announcementRecipients(db, hm, target(prepare))).rejects.toThrow(ForbiddenError);
    await expect(sendAnnouncement(db, deps, hm, target(prepare))).rejects.toThrow(ForbiddenError);
  });
});
