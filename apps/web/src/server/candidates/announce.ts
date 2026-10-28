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

type Group = "waiting_on" | "submitted" | "pipeline";

type Announcement = {
  label: string;
  audience: string;
  /** waiting_on / submitted: relative to the chosen step. pipeline: everyone still in the process. */
  group: Group;
  /** Only these roles (slugs) can receive it; other tracks get an empty list. */
  roles?: readonly string[];
  /** One email per person, naming each of their roles above, instead of one per application. */
  oncePerPerson?: boolean;
};

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
  final_extension_bgi: {
    label: "Final extension to 31 October (Business Growth)",
    audience:
      "Everyone still in the Business Growth process, at any step, including those who submitted the task. Once per person. The step choice doesn't matter.",
    group: "pipeline",
    roles: ["bgi"],
    oncePerPerson: true,
  },
  final_extension_details: {
    label: "Final extension to 31 October: details forms (SDE and PM)",
    audience:
      "Everyone still in the Software Engineering or Product Management process. Once per person, naming both roles for people in both. The step choice doesn't matter.",
    group: "pipeline",
    roles: ["sde", "pm"],
    oncePerPerson: true,
  },
} as const satisfies Record<string, Announcement>;
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
  const announcement: Announcement = ANNOUNCEMENTS[input.key];
  const group = announcement.group;
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
      roleSlug: roles.slug,
    })
    .from(applications)
    .innerJoin(candidates, eq(candidates.id, applications.candidateId))
    .innerJoin(users, eq(users.id, candidates.userId))
    .innerJoin(roles, eq(roles.id, applications.roleId))
    .where(
      and(
        eq(applications.workflowId, input.workflowId),
        eq(applications.testMode, false),
        group === "pipeline"
          ? undefined
          : group === "submitted"
            ? submittedStep
            : sql`not (${submittedStep})`,
      ),
    );
  const open = rows.filter(
    (r) =>
      r.status !== "closed_rejected" &&
      r.status !== "closed_withdrawn" &&
      (!announcement.roles || announcement.roles.includes(r.roleSlug)),
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
  const once = announcement.oncePerPerson
    ? await oncePerPerson(db, open, input.key, announcement)
    : null;
  // Where each person is now, and whether they've already handed that step in.
  const handedIn =
    group === "pipeline" && open.length
      ? new Set(
          (
            await db
              .select({ applicationId: stageProgress.applicationId, nodeId: stageProgress.nodeId })
              .from(stageProgress)
              .where(
                and(
                  inArray(
                    stageProgress.applicationId,
                    open.map((r) => r.applicationId),
                  ),
                  sql`${stageProgress.submittedAt} is not null`,
                ),
              )
          ).map((p) => `${p.applicationId}:${p.nodeId}`),
        )
      : new Set<string>();
  return open.map((r) => {
    const current = titles.get(r.currentNodeId ?? "");
    const stageTitle =
      group === "submitted"
        ? titles.get(input.nodeId)
        : current &&
          (handedIn.has(`${r.applicationId}:${r.currentNodeId}`)
            ? `${current} (submitted)`
            : current);
    return {
      applicationId: r.applicationId,
      userId: r.userId,
      email: r.email,
      name: r.name,
      roleTitle: once?.roles.get(r.userId) ?? r.roleTitle,
      stageTitle: stageTitle ?? "your current step",
      alreadySent: once ? once.sent.has(r.userId) : sentIds.has(r.applicationId),
    };
  });
}

/**
 * For once-per-person emails: who already has it (for any of their applications), and every
 * role of theirs it covers, e.g. "Product Management Intern and Software Engineering Intern".
 */
async function oncePerPerson(
  db: Db,
  people: { userId: string }[],
  key: AnnouncementKey,
  announcement: Announcement,
) {
  const userIds = [...new Set(people.map((p) => p.userId))];
  if (userIds.length === 0) return { sent: new Set<string>(), roles: new Map<string, string>() };
  const sent = await db
    .select({ userId: emailMessages.userId })
    .from(emailMessages)
    .where(and(eq(emailMessages.templateKey, key), inArray(emailMessages.userId, userIds)));
  const apps = await db
    .select({
      userId: candidates.userId,
      title: roles.title,
      slug: roles.slug,
      status: applications.status,
    })
    .from(applications)
    .innerJoin(candidates, eq(candidates.id, applications.candidateId))
    .innerJoin(roles, eq(roles.id, applications.roleId))
    .where(and(inArray(candidates.userId, userIds), eq(applications.testMode, false)))
    .orderBy(roles.title);
  const titles = new Map<string, string[]>();
  for (const a of apps) {
    if (a.status === "closed_rejected" || a.status === "closed_withdrawn") continue;
    if (announcement.roles && !announcement.roles.includes(a.slug)) continue;
    titles.set(a.userId, [...new Set([...(titles.get(a.userId) ?? []), a.title])]);
  }
  return {
    sent: new Set(sent.map((s) => s.userId).filter((u): u is string => !!u)),
    roles: new Map([...titles].map(([u, t]) => [u, t.join(" and ")])),
  };
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
