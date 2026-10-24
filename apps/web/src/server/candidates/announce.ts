import {
  and,
  eq,
  inArray,
  sql,
  applications,
  candidates,
  cycles,
  emailMessages,
  roles,
  stageProgress,
  users,
  workflowVersions,
  workflows,
  type Db,
} from "@iclabs/db";
import { workflowConfigSchema, type Actor } from "@iclabs/core";
import { assertCan, audit } from "../audit";
import type { EnqueueInput } from "../email/outbox";
import type { TemplateKey } from "../email/templates";

const ADMIN_ONLY = { type: "team_settings" } as const;

type Group = "waiting_on" | "submitted";

/** The mass emails an admin can send, and who each one goes to (relative to the chosen step). */
export const ANNOUNCEMENTS = {
  task_last_extension: {
    label: "Last extension: task due 26 October",
    audience:
      "Everyone in the track who hasn't submitted the chosen step yet, wherever they are. Each is told which step they're on.",
    group: "waiting_on",
  },
  task_prepare: {
    label: "Get ready for the task round",
    audience: "Everyone who has submitted the chosen step",
    group: "submitted",
  },
} as const satisfies Record<string, { label: string; audience: string; group: Group }>;
export type AnnouncementKey = keyof typeof ANNOUNCEMENTS & TemplateKey;

export type Recipient = {
  applicationId: string;
  userId: string;
  email: string;
  name: string;
  roleTitle: string;
  /** The step this person is on now ("waiting_on") or the step they submitted ("submitted"). */
  stageTitle: string;
  alreadySent: boolean;
};

/** Tracks and their published steps, for the picker. */
export async function listAnnouncementTracks(db: Db, actor: Actor) {
  assertCan(actor, "manage", ADMIN_ONLY);
  const rows = await db
    .select({
      workflowId: workflows.id,
      track: workflows.name,
      role: roles.title,
      cycle: cycles.name,
      config: workflowVersions.config,
    })
    .from(workflows)
    .innerJoin(cycles, eq(cycles.id, workflows.cycleId))
    .innerJoin(roles, eq(roles.id, cycles.roleId))
    .innerJoin(workflowVersions, eq(workflowVersions.id, workflows.publishedVersionId))
    .orderBy(roles.title);
  return rows.map((r) => {
    const parsed = workflowConfigSchema.safeParse(r.config);
    return {
      workflowId: r.workflowId,
      label: `${r.role} · ${r.cycle} · ${r.track}`,
      nodes: parsed.success
        ? parsed.data.nodes
            .filter((n) => n.visibility === "candidate" && n.type !== "interview")
            .map((n) => ({ id: n.id, title: n.title }))
        : [],
    };
  });
}

/** Step titles by id. Each person's application is pinned to its own version, so this is per version. */
async function stepTitles(db: Db, workflowId: string) {
  const versions = await db
    .select({ config: workflowVersions.config })
    .from(workflowVersions)
    .where(eq(workflowVersions.workflowId, workflowId));
  const titles = new Map<string, string>();
  for (const v of versions) {
    const parsed = workflowConfigSchema.safeParse(v.config);
    if (parsed.success) for (const n of parsed.data.nodes) titles.set(n.id, n.title);
  }
  return titles;
}

/**
 * Everyone the email would go to right now. Test accounts and closed applications are left out.
 * "waiting_on": people who haven't submitted the chosen step (including ones stuck earlier, even
 * past a deadline). "submitted": people who have.
 */
export async function announcementRecipients(
  db: Db,
  actor: Actor,
  input: { workflowId: string; nodeId: string; key: AnnouncementKey },
): Promise<Recipient[]> {
  assertCan(actor, "manage", ADMIN_ONLY);
  const group = ANNOUNCEMENTS[input.key].group;
  const submittedStep = sql`exists (select 1 from ${stageProgress} sp where sp.application_id = ${applications.id} and sp.node_id = ${input.nodeId} and sp.submitted_at is not null)`;
  const rows = await db
    .select({
      applicationId: applications.id,
      userId: users.id,
      email: users.email,
      name: candidates.name,
      roleTitle: roles.title,
      status: applications.status,
      currentNodeId: applications.currentNodeId,
    })
    .from(applications)
    .innerJoin(candidates, eq(candidates.id, applications.candidateId))
    .innerJoin(users, eq(users.id, candidates.userId))
    .innerJoin(roles, eq(roles.id, applications.roleId))
    .where(
      and(
        eq(applications.workflowId, input.workflowId),
        eq(applications.testMode, false),
        group === "submitted" ? submittedStep : sql`not (${submittedStep})`,
      ),
    );
  const open = rows.filter(
    (r) => r.status !== "closed_rejected" && r.status !== "closed_withdrawn",
  );
  const titles = await stepTitles(db, input.workflowId);
  const sent = open.length
    ? await db
        .select({ applicationId: emailMessages.applicationId })
        .from(emailMessages)
        .where(
          and(
            eq(emailMessages.templateKey, input.key),
            inArray(
              emailMessages.applicationId,
              open.map((r) => r.applicationId),
            ),
          ),
        )
    : [];
  const sentIds = new Set(sent.map((s) => s.applicationId));
  return open.map((r) => ({
    applicationId: r.applicationId,
    userId: r.userId,
    email: r.email,
    name: r.name,
    roleTitle: r.roleTitle,
    stageTitle:
      (group === "waiting_on" ? titles.get(r.currentNodeId ?? "") : titles.get(input.nodeId)) ??
      "your current step",
    alreadySent: sentIds.has(r.applicationId),
  }));
}

/** Queues the email for every recipient who hasn't had this one yet. Safe to run twice. */
export async function sendAnnouncement(
  db: Db,
  deps: { queueEmail: (input: EnqueueInput) => Promise<string>; appUrl: (path: string) => string },
  actor: Actor,
  input: { workflowId: string; nodeId: string; key: AnnouncementKey },
) {
  assertCan(actor, "manage", ADMIN_ONLY);
  const recipients = await announcementRecipients(db, actor, input);
  const todo = recipients.filter((r) => !r.alreadySent);
  for (const r of todo) {
    await deps.queueEmail({
      to: r.email,
      templateKey: input.key,
      userId: r.userId,
      applicationId: r.applicationId,
      vars: {
        first_name: r.name.trim().split(/\s+/)[0] ?? r.name,
        role: r.roleTitle,
        stage: r.stageTitle,
        stage_url: deps.appUrl("/dashboard"),
      },
    });
  }
  await audit(db, {
    actorUserId: actor.userId,
    action: "announcement_sent",
    entity: "workflow",
    entityId: input.workflowId,
    after: {
      key: input.key,
      nodeId: input.nodeId,
      sent: todo.length,
      skipped: recipients.length - todo.length,
    },
  });
  return { sent: todo.length, skipped: recipients.length - todo.length };
}
