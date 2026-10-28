import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  and,
  eq,
  applications,
  cycles,
  emailMessages,
  stageProgress,
  workflows,
  type Db,
} from "@iclabs/db";
import { createTestDb } from "@iclabs/db/testing";
import { createNode, emptyWorkflow, type WorkflowConfig } from "@iclabs/core";
import { teamActor } from "../../test/fixtures";
import { createCandidateAccount } from "../auth/candidate-auth";
import { enqueueEmail } from "../email/outbox";
import { DEFAULT_TEMPLATES, renderEmail } from "../email/templates";
import {
  createCycle,
  createRole,
  getBuilderData,
  getCycleDetail,
  publishDraft,
  saveDraft,
} from "../hiring/structure";
import { loadPinned, unlockNode } from "../stages/progression";
import { announcementRecipients, sendAnnouncement } from "./announce";
import {
  applyFinalExtension,
  automaticSteps,
  extensionTracks,
  finalExtensionPlan,
} from "./final-extension";

let db: Db;
let close: () => Promise<void>;
let admin: Awaited<ReturnType<typeof teamActor>>;
const config = { secretKey: randomBytes(32).toString("base64") };
const deps = {
  queueEmail: (input: Parameters<typeof enqueueEmail>[2]) => enqueueEmail(db, config, input),
  appUrl: (p: string) => `https://w${p}`,
};
const UNTIL = new Date("2026-10-31T23:59:00+05:30");
const BEFORE = new Date("2026-10-27T23:59:00+05:30");

/** The live processes' shapes: BGI runs straight to the task; SDE/PM stop for a decision. */
const BGI: WorkflowConfig = {
  ...emptyWorkflow(),
  nodes: [
    createNode("form", { id: "details", title: "Your details" }),
    createNode("form", { id: "own_words", title: "In your own words" }),
    createNode("task", { id: "task", title: "Industry research" }),
  ],
  edges: [
    { id: "a", from: "details", to: "own_words", priority: 0, when: { always: true } },
    { id: "b", from: "own_words", to: "task", priority: 0, when: { always: true } },
    { id: "c", from: "task", to: "END_COMPLETE", priority: 0, when: { always: true } },
  ],
};
const DETAILS: WorkflowConfig = {
  ...emptyWorkflow(),
  nodes: [
    createNode("form", { id: "details", title: "Your details" }),
    createNode("form", { id: "how_you_think", title: "How you think" }),
    createNode("task", { id: "task", title: "The task" }),
  ],
  edges: [
    { id: "a", from: "details", to: "how_you_think", priority: 0, when: { always: true } },
    { id: "b", from: "how_you_think", to: "NEEDS_DECISION", priority: 0, when: { always: true } },
    {
      id: "c",
      from: "how_you_think",
      to: "task",
      priority: 1,
      when: { consensus: "all_yes" },
    },
    { id: "d", from: "task", to: "END_COMPLETE", priority: 0, when: { always: true } },
  ],
};
for (const c of [BGI, DETAILS])
  for (const n of c.nodes) if (n.type === "task") n.reviewers!.pool = ["someone"];

async function track(slug: string, title: string, cfg: WorkflowConfig) {
  const role = await createRole(db, admin, { title, slug });
  const cycle = await createCycle(db, admin, { roleId: role.id, name: "October 2026" });
  const { tracks } = await getCycleDetail(db, admin, cycle.id);
  const workflowId = tracks[0]!.id;
  const data = await getBuilderData(db, admin, workflowId);
  await saveDraft(db, admin, {
    workflowId,
    versionId: data.draft!.id,
    etag: data.draft!.etag,
    config: cfg,
  });
  await publishDraft(db, admin, { workflowId, versionId: data.draft!.id });
  return workflowId;
}

/** Someone on `node` in `workflowId`, with that step's dates and state. */
async function person(
  workflowId: string,
  who: { name: string; email: string } | { candidateId: string },
  opts: {
    node: string;
    state: "unlocked" | "in_progress" | "submitted" | "missed";
    testMode?: boolean;
    status?: "active" | "needs_decision" | "closed_rejected";
    dueAt?: Date;
    extendedUntil?: Date;
  },
) {
  const [wf] = await db.select().from(workflows).where(eq(workflows.id, workflowId));
  const [cycle] = await db.select().from(cycles).where(eq(cycles.id, wf!.cycleId));
  const candidateId =
    "candidateId" in who ? who.candidateId : (await createCandidateAccount(db, who)).candidateId;
  const [app] = await db
    .insert(applications)
    .values({
      candidateId,
      roleId: cycle!.roleId,
      workflowId,
      workflowVersionId: wf!.publishedVersionId,
      currentNodeId: opts.node,
      testMode: opts.testMode ?? false,
      status: opts.status ?? "active",
    })
    .returning();
  const [p] = await db
    .insert(stageProgress)
    .values({
      applicationId: app!.id,
      nodeId: opts.node,
      state: opts.state,
      dueAt: opts.dueAt ?? BEFORE,
      extendedUntil: opts.extendedUntil ?? null,
      submittedAt: opts.state === "submitted" ? new Date() : null,
    })
    .returning();
  return { appId: app!.id, progressId: p!.id, candidateId };
}

let bgi: string, sde: string, pm: string;
const ppl: Record<string, Awaited<ReturnType<typeof person>>> = {};

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  admin = await teamActor(db, "admin");
  bgi = await track("bgi", "Business Growth Intern (Sales)", BGI);
  sde = await track("sde", "Software Engineering Intern", DETAILS);
  pm = await track("pm", "Product Management Intern", DETAILS);

  ppl.onDetails = await person(
    bgi,
    { name: "Asha Rao", email: "asha@x.com" },
    {
      node: "details",
      state: "unlocked",
    },
  );
  ppl.missedTask = await person(
    bgi,
    { name: "Bilal Khan", email: "bilal@x.com" },
    {
      node: "task",
      state: "missed",
      status: "needs_decision",
    },
  );
  ppl.submittedTask = await person(
    bgi,
    { name: "Chitra Iyer", email: "chitra@x.com" },
    {
      node: "task",
      state: "submitted",
    },
  );
  ppl.later = await person(
    bgi,
    { name: "Dev Later", email: "dev@x.com" },
    {
      node: "own_words",
      state: "unlocked",
      dueAt: new Date("2026-11-02T23:59:00+05:30"),
    },
  );
  ppl.test = await person(
    bgi,
    { name: "Test Tester", email: "tester@x.com" },
    {
      node: "details",
      state: "unlocked",
      testMode: true,
    },
  );
  ppl.closed = await person(
    bgi,
    { name: "Gone Away", email: "gone@x.com" },
    {
      node: "details",
      state: "unlocked",
      status: "closed_rejected",
    },
  );
  // In both SDE and PM.
  ppl.dualSde = await person(
    sde,
    { name: "Esha Both", email: "esha@x.com" },
    {
      node: "how_you_think",
      state: "in_progress",
    },
  );
  ppl.dualPm = await person(
    pm,
    { candidateId: ppl.dualSde.candidateId },
    {
      node: "details",
      state: "unlocked",
    },
  );
  ppl.pmOnly = await person(
    pm,
    { name: "Farah Pm", email: "farah@x.com" },
    {
      node: "details",
      state: "unlocked",
    },
  );
});
afterAll(() => close());

const plan = () => ({
  until: UNTIL,
  steps: [
    { workflowId: bgi, nodeIds: ["details", "own_words", "task"] },
    { workflowId: sde, nodeIds: ["details", "how_you_think"] },
    { workflowId: pm, nodeIds: ["details", "how_you_think"] },
  ],
});

describe("which steps a final extension covers", () => {
  it("ticks the steps reached without a team decision: BGI through the task, SDE/PM the forms", async () => {
    expect([...automaticSteps(BGI)]).toEqual(["details", "own_words", "task"]);
    expect([...automaticSteps(DETAILS)]).toEqual(["details", "how_you_think"]);
    const tracks = await extensionTracks(db, admin);
    const auto = (id: string) =>
      tracks
        .find((t) => t.workflowId === id)!
        .nodes.filter((n) => n.auto)
        .map((n) => n.id);
    expect(auto(bgi)).toEqual(["details", "own_words", "task"]);
    expect(auto(sde)).toEqual(["details", "how_you_think"]);
  });
});

describe("final extension", () => {
  it("lists open steps only, leaves out closed, test and submitted, and never shortens", async () => {
    const { rows, notYetOpen } = await finalExtensionPlan(db, admin, plan());
    const byEmail = Object.fromEntries(rows.map((r) => [r.email, r.action]));
    expect(byEmail).toEqual({
      "asha@x.com": "extend",
      "bilal@x.com": "reopen",
      "dev@x.com": "keep",
      "esha@x.com": "extend",
      "farah@x.com": "extend",
    });
    // esha appears twice (SDE and PM); the PM row is hers too.
    expect(rows.filter((r) => r.email === "esha@x.com")).toHaveLength(2);
    expect(notYetOpen.find((n) => n.step === "Industry research")?.people).toBe(2);
  });

  it("refuses if the list changed since it was reviewed", async () => {
    expect(await applyFinalExtension(db, admin, plan(), { changes: 1 })).toMatchObject({
      ok: false,
    });
  });

  it("extends, reopens missed steps, keeps later dates, and caps steps that open later", async () => {
    const res = await applyFinalExtension(db, admin, plan(), { changes: 5 });
    expect(res).toEqual({ ok: true, extended: 5, reopened: 1 });

    const get = async (id: string) =>
      (await db.select().from(stageProgress).where(eq(stageProgress.id, id)))[0]!;
    expect((await get(ppl.onDetails!.progressId)).extendedUntil).toEqual(UNTIL);
    const reopened = await get(ppl.missedTask!.progressId);
    expect(reopened).toMatchObject({ state: "unlocked", extendedUntil: UNTIL });
    const [app] = await db
      .select()
      .from(applications)
      .where(eq(applications.id, ppl.missedTask!.appId));
    expect(app!.status).toBe("active");
    expect((await get(ppl.later!.progressId)).extendedUntil).toBeNull();
    expect((await get(ppl.submittedTask!.progressId)).extendedUntil).toBeNull();
    expect((await get(ppl.test!.progressId)).extendedUntil).toBeNull();
    expect((await get(ppl.closed!.progressId)).extendedUntil).toBeNull();

    // Asha finishes her details on 30 Oct: "In your own words" opens due 31 Oct, not 3 Nov.
    const pinned = await loadPinned(db, ppl.onDetails!.appId);
    await unlockNode(
      db,
      { ...deps, now: () => new Date("2026-10-30T10:00:00+05:30") },
      pinned,
      "own_words",
    );
    const [next] = await db
      .select()
      .from(stageProgress)
      .where(
        and(
          eq(stageProgress.applicationId, ppl.onDetails!.appId),
          eq(stageProgress.nodeId, "own_words"),
        ),
      );
    expect(next!.dueAt).toEqual(UNTIL);
    expect(next!.graceUntil).toBeNull();

    // A second run changes nothing: everyone open is already at the date.
    const again = await finalExtensionPlan(db, admin, plan());
    expect(again.rows.filter((r) => r.action !== "keep")).toHaveLength(0);
  });

  it("sends no email", async () => {
    expect(await db.select().from(emailMessages)).toEqual([]);
  });
});

describe("final extension emails", () => {
  const bgiEmail = { workflowId: "", nodeId: "details", key: "final_extension_bgi" } as const;
  const detailsEmail = { nodeId: "details", key: "final_extension_details" } as const;

  it("BGI: everyone still in the process, naming each person's step", async () => {
    const list = await announcementRecipients(db, admin, { ...bgiEmail, workflowId: bgi });
    const step = Object.fromEntries(list.map((r) => [r.email, r.stageTitle]));
    expect(step).toEqual({
      "asha@x.com": "In your own words",
      "bilal@x.com": "Industry research",
      "chitra@x.com": "Industry research (submitted)",
      "dev@x.com": "In your own words",
    });
  });

  it("only goes to the roles it was written for", async () => {
    expect(await announcementRecipients(db, admin, { ...bgiEmail, workflowId: sde })).toEqual([]);
    expect(await announcementRecipients(db, admin, { ...detailsEmail, workflowId: bgi })).toEqual(
      [],
    );
  });

  it("SDE and PM: one email per person, naming both roles for people in both", async () => {
    const first = await sendAnnouncement(db, deps, admin, { ...detailsEmail, workflowId: sde });
    expect(first).toEqual({ sent: 1, skipped: 0 });
    const pmList = await announcementRecipients(db, admin, { ...detailsEmail, workflowId: pm });
    expect(pmList.map((r) => [r.email, r.alreadySent])).toEqual([
      ["esha@x.com", true],
      ["farah@x.com", false],
    ]);
    const second = await sendAnnouncement(db, deps, admin, { ...detailsEmail, workflowId: pm });
    expect(second).toEqual({ sent: 1, skipped: 1 });
    // Running either again sends nothing.
    expect(await sendAnnouncement(db, deps, admin, { ...detailsEmail, workflowId: pm })).toEqual({
      sent: 0,
      skipped: 2,
    });

    const sent = await db
      .select()
      .from(emailMessages)
      .where(eq(emailMessages.templateKey, "final_extension_details"));
    expect(sent.map((e) => e.toEmail).sort()).toEqual(["esha@x.com", "farah@x.com"]);
    const esha = sent.find((e) => e.toEmail === "esha@x.com")!;
    expect(esha.vars.role).toBe("Product Management Intern and Software Engineering Intern");
    const text = renderEmail(DEFAULT_TEMPLATES.final_extension_details, esha.vars).text;
    expect(text).toContain("31 October, end of day (11:59 pm IST)");
    expect(text).toContain("released to shortlisted candidates on 2 November");
    expect(text).toContain("Login expired? Get fresh credentials here");
    expect(text).toContain("Please send any queries to hr@isocodelabs.com only.");
  });
});
