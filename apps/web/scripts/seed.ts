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
  questions,
  roles,
  teamMembers,
  workflowVersions,
  workflows,
  applications,
  eq,
} from "@iclabs/db";
import { createNode, emptyWorkflow, type WorkflowConfig } from "@iclabs/core";
import { createCandidateAccount } from "../src/server/auth/candidate-auth";
import { startApplication } from "../src/server/stages/progression";

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

// A few approved questions so the starter quiz works out of the box.
const existing = await db.select({ id: questions.id }).from(questions).limit(1);
if (existing.length === 0) {
  const q = (body: string, options: string[], correct: number) => ({
    type: "mcq" as const,
    body,
    options: options.map((text, i) => ({ id: `o${i}`, text })),
    correct: [`o${correct}`],
    tags: ["general"],
    difficulty: "easy" as const,
    status: "approved" as const,
  });
  await db
    .insert(questions)
    .values([
      q("Which of these is a version control system?", ["Git", "Figma", "Excel"], 0),
      q(
        "What does an MVP stand for in product work?",
        ["Most Valuable Player", "Minimum Viable Product", "Maximum Value Plan"],
        1,
      ),
      q(
        "A customer says the price is too high. What's a good first response?",
        ["Offer a discount immediately", "Ask what they're comparing it to", "End the call"],
        1,
      ),
    ]);
}

/** Details form → quick quiz → take-home task → interview: a small process to try the portal. */
function starter(roleTitle: string): WorkflowConfig {
  const details = createNode("form", { title: "Your details" });
  details.config.fields = [
    { id: "why", label: `Why ${roleTitle}?`, kind: "long_text", required: true },
    { id: "portfolio", label: "Portfolio or GitHub link", kind: "url", required: false },
  ];
  const task = createNode("task", { title: "Take-home task" });
  task.config.brief = "Describe the task here in the Process Builder.";
  task.reviewers!.pool = [adminMemberId];
  task.config.deliverables = [
    { id: "link", kind: "link", label: "Link to your work", required: true },
    { id: "doc", kind: "file", label: "Supporting document (optional)", required: false },
  ];
  const quiz = createNode("assessment", { title: "Quick quiz" });
  quiz.config.durationMin = 10;
  quiz.config.questions.draw = [{ tags: ["general"], count: 3 }];
  const interview = createNode("interview", { title: "Founder call" });
  interview.config.interviewerPool = [adminMemberId];
  const nodes = [details, quiz, task, interview];
  return {
    ...emptyWorkflow(),
    nodes,
    edges: [
      { id: "e0", from: details.id, to: quiz.id, priority: 0, when: { always: true } },
      { id: "e1", from: quiz.id, to: task.id, priority: 0, when: { always: true } },
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

const targets: Record<string, { roleId: string; workflowId: string; versionId: string }> = {};
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
      const [app] = await db
        .insert(applications)
        .values({
          candidateId,
          roleId: t.roleId,
          workflowId: t.workflowId,
          workflowVersionId: t.versionId,
          testMode: true,
        })
        .returning();
      await startApplication(db, { queueEmail: async () => "seed", appUrl: (p) => p }, app!.id);
    }
    console.log(
      `Candidate ${c.email} → temp password ${tempPassword} (roles: ${c.roles.join(", ")})`,
    );
  } catch {
    console.log(`Candidate ${c.email} already exists; skipped`);
  }
}

process.exit(0);
