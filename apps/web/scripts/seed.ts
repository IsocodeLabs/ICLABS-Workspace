/**
 * Local/staging seed: the three Cycle 1 roles, each with an open round and a small published
 * starter process, an admin allow-list entry, and two test candidates. Prints the test
 * candidates' temporary passwords, which is why it refuses to run in production.
 *
 *   SEED_ADMIN_EMAIL=you@isocodelabs.com pnpm db:seed
 */
import {
  createDb,
  cycles,
  roles,
  teamMembers,
  workflowVersions,
  workflows,
  applications,
  eq,
} from "@iclabs/db";
import { createNode, entryNodeId, emptyWorkflow, type WorkflowConfig } from "@iclabs/core";
import { createCandidateAccount } from "../src/server/auth/candidate-auth";

if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed production");
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? "admin@isocodelabs.com").toLowerCase();

const db = createDb(url);

const [admin] = await db
  .insert(teamMembers)
  .values({ email: adminEmail, role: "admin" })
  .onConflictDoNothing()
  .returning();
const adminMemberId =
  admin?.id ??
  (await db.select().from(teamMembers).where(eq(teamMembers.email, adminEmail)))[0]!.id;
console.log(`Admin allow-listed: ${adminEmail}`);

/** Details form → take-home task → interview: a small process to try the portal with. */
function starter(roleTitle: string): WorkflowConfig {
  const details = createNode("form", { title: "Your details" });
  details.config.fields = [
    { id: "why", label: `Why ${roleTitle}?`, kind: "long_text", required: true },
    { id: "portfolio", label: "Portfolio or GitHub link", kind: "url", required: false },
  ];
  const task = createNode("task", { title: "Take-home task" });
  task.config.brief = "Describe the task here in the Process Builder.";
  task.reviewers!.pool = [adminMemberId];
  const interview = createNode("interview", { title: "Founder call" });
  interview.config.interviewerPool = [adminMemberId];
  const nodes = [details, task, interview];
  return {
    ...emptyWorkflow(),
    nodes,
    edges: [
      { id: "e1", from: details.id, to: task.id, priority: 0, when: { always: true } },
      {
        id: "e2",
        from: task.id,
        to: interview.id,
        priority: 0,
        when: { metric: "rubric_pct", op: ">=", value: 60 },
      },
      { id: "e3", from: task.id, to: "NEEDS_DECISION", priority: 1, when: { always: true } },
      { id: "e4", from: interview.id, to: "END_COMPLETE", priority: 0, when: { always: true } },
    ],
    layout: Object.fromEntries(nodes.map((n, i) => [n.id, { x: i * 340, y: 0 }])),
  };
}

const ROLES = [
  { slug: "bdi", title: "Business Development Intern", seats: 10 },
  { slug: "sde", title: "SDE Intern", seats: 5 },
  { slug: "pm", title: "PM Intern", seats: 5 },
];

const targets: Record<
  string,
  { roleId: string; workflowId: string; versionId: string; entry: string | null }
> = {};
for (const r of ROLES) {
  const [role] = await db.insert(roles).values(r).onConflictDoNothing().returning();
  if (!role) continue;
  const [cycle] = await db
    .insert(cycles)
    .values({ roleId: role.id, name: "Cycle 1", status: "open" })
    .returning();
  const [wf] = await db
    .insert(workflows)
    .values({ cycleId: cycle!.id, name: "Main", isDefault: true })
    .returning();
  const config = starter(r.title);
  const [v] = await db
    .insert(workflowVersions)
    .values({
      workflowId: wf!.id,
      version: 1,
      status: "published",
      config,
      publishedAt: new Date(),
      changeSummary: "Seed starter process",
    })
    .returning();
  await db.update(workflows).set({ publishedVersionId: v!.id }).where(eq(workflows.id, wf!.id));
  targets[r.slug] = {
    roleId: role.id,
    workflowId: wf!.id,
    versionId: v!.id,
    entry: entryNodeId(config),
  };
}

const testCandidates = [
  { email: "test.candidate1@example.com", name: "Test Candidate One", roles: ["sde", "pm"] },
  { email: "test.candidate2@example.com", name: "Test Candidate Two", roles: ["bdi"] },
];
for (const c of testCandidates) {
  try {
    const { candidateId, tempPassword } = await createCandidateAccount(db, c);
    for (const slug of c.roles) {
      const t = targets[slug];
      if (!t) continue;
      await db.insert(applications).values({
        candidateId,
        roleId: t.roleId,
        workflowId: t.workflowId,
        workflowVersionId: t.versionId,
        currentNodeId: t.entry,
        testMode: true,
      });
    }
    console.log(
      `Candidate ${c.email} → temp password ${tempPassword} (roles: ${c.roles.join(", ")})`,
    );
  } catch {
    console.log(`Candidate ${c.email} already exists; skipped`);
  }
}

process.exit(0);
