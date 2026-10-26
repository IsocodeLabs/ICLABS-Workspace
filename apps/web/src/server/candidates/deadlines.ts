import {
  and,
  eq,
  inArray,
  isNotNull,
  sql,
  applications,
  candidates,
  emailMessages,
  stageProgress,
  users,
  type Db,
} from "@iclabs/db";
import type { Actor } from "@iclabs/core";
import { assertCan, audit } from "../audit";
import { restartDeadlinesFromLogin } from "../stages/progression";

const ADMIN_ONLY = { type: "team_settings" } as const;

/** Stage rows whose dates still matter: open, missed (can reopen) or submitted (can resubmit). */
const DATED_STATES = ["unlocked", "in_progress", "missed", "submitted"] as const;

export type StepDeadlineRow = {
  progressId: string;
  applicationId: string;
  name: string;
  email: string;
  state: (typeof DATED_STATES)[number];
  dueAt: Date | null;
  /** When submissions stop for good: extension, else grace, else the due time. */
  closesAt: Date | null;
  extended: boolean;
};

/** Everyone who has reached the step, with the dates each one has now. Test accounts left out. */
export async function stepDeadlineRows(
  db: Db,
  actor: Actor,
  input: { workflowId: string; nodeId: string },
): Promise<StepDeadlineRow[]> {
  assertCan(actor, "manage", ADMIN_ONLY);
  const rows = await db
    .select({
      progressId: stageProgress.id,
      applicationId: applications.id,
      name: candidates.name,
      email: users.email,
      state: stageProgress.state,
      dueAt: stageProgress.dueAt,
      graceUntil: stageProgress.graceUntil,
      extendedUntil: stageProgress.extendedUntil,
    })
    .from(stageProgress)
    .innerJoin(applications, eq(applications.id, stageProgress.applicationId))
    .innerJoin(candidates, eq(candidates.id, applications.candidateId))
    .innerJoin(users, eq(users.id, candidates.userId))
    .where(
      and(
        eq(applications.workflowId, input.workflowId),
        eq(applications.testMode, false),
        eq(stageProgress.nodeId, input.nodeId),
        inArray(stageProgress.state, [...DATED_STATES]),
      ),
    )
    .orderBy(candidates.name);
  return rows.map((r) => ({
    progressId: r.progressId,
    applicationId: r.applicationId,
    name: r.name,
    email: r.email,
    state: r.state as StepDeadlineRow["state"],
    dueAt: r.dueAt,
    closesAt: r.extendedUntil ?? r.graceUntil ?? r.dueAt,
    extended: r.extendedUntil !== null,
  }));
}

/**
 * Gives everyone at the step the same dates: on time until `dueAt`, accepted but marked late
 * until `closesAt`, then closed. Per-person extensions are cleared (an extension would otherwise
 * win over these dates), and anyone marked missed whose new close is still ahead is reopened.
 */
export async function setStepDeadline(
  db: Db,
  actor: Actor,
  input: { workflowId: string; nodeId: string; dueAt: Date; closesAt: Date },
  now = new Date(),
) {
  assertCan(actor, "manage", ADMIN_ONLY);
  if (input.closesAt < input.dueAt)
    return { ok: false as const, error: "The final close can't be before the on-time deadline." };
  const rows = await stepDeadlineRows(db, actor, input);
  const reopen = input.closesAt > now;
  let reopened = 0;
  for (const r of rows) {
    const wasMissed = r.state === "missed";
    await db
      .update(stageProgress)
      .set({
        dueAt: input.dueAt,
        graceUntil: input.closesAt > input.dueAt ? input.closesAt : null,
        extendedUntil: null,
        reminderSentAt: null,
        ...(wasMissed && reopen ? { state: "unlocked" as const } : {}),
      })
      .where(eq(stageProgress.id, r.progressId));
    if (wasMissed && reopen) {
      reopened++;
      await db
        .update(applications)
        .set({ status: "active" })
        .where(
          and(eq(applications.id, r.applicationId), eq(applications.status, "needs_decision")),
        );
    }
  }
  await audit(db, {
    actorUserId: actor.userId,
    action: "step_deadline_set",
    entity: "workflow",
    entityId: input.workflowId,
    after: {
      nodeId: input.nodeId,
      dueAt: input.dueAt.toISOString(),
      closesAt: input.closesAt.toISOString(),
      updated: rows.length,
      extensionsCleared: rows.filter((r) => r.extended).length,
      reopened,
    },
  });
  return { ok: true as const, updated: rows.length, reopened };
}

export type LoginDeadlineChange = {
  name: string;
  email: string;
  nodeId: string;
  loginEmailAt: Date;
  oldDueAt: Date | null;
  dueAt: Date;
  reopened: boolean;
};

/**
 * Re-times everyone on a track from their latest login email (welcome or role added), for
 * steps they hadn't started: people mailed days after their invite get the full time to
 * respond. `dryRun` previews; otherwise it applies. Never shortens a deadline.
 */
export async function restartTrackFromLoginEmails(
  db: Db,
  actor: Actor,
  input: { workflowId: string; dryRun: boolean },
  now = new Date(),
): Promise<LoginDeadlineChange[]> {
  assertCan(actor, "manage", ADMIN_ONLY);
  const latest = await db
    .select({
      userId: users.id,
      name: candidates.name,
      email: users.email,
      at: sql<string>`max(${emailMessages.sentAt})`,
    })
    .from(emailMessages)
    .innerJoin(users, eq(users.id, emailMessages.userId))
    .innerJoin(candidates, eq(candidates.userId, users.id))
    .innerJoin(applications, eq(applications.candidateId, candidates.id))
    .where(
      and(
        inArray(emailMessages.templateKey, ["welcome", "role_added"]),
        isNotNull(emailMessages.sentAt),
        eq(applications.workflowId, input.workflowId),
        eq(applications.testMode, false),
      ),
    )
    .groupBy(users.id, candidates.name, users.email);
  const out: LoginDeadlineChange[] = [];
  for (const l of latest) {
    const loginEmailAt = new Date(l.at);
    const changes = await restartDeadlinesFromLogin(db, l.userId, loginEmailAt, {
      workflowId: input.workflowId,
      dryRun: input.dryRun,
      now,
    });
    for (const c of changes)
      out.push({
        name: l.name,
        email: l.email,
        nodeId: c.nodeId,
        loginEmailAt,
        oldDueAt: c.oldDueAt,
        dueAt: c.dueAt,
        reopened: c.reopened,
      });
  }
  if (!input.dryRun)
    await audit(db, {
      actorUserId: actor.userId,
      action: "deadlines_restarted_from_login",
      entity: "workflow",
      entityId: input.workflowId,
      after: { updated: out.length, reopened: out.filter((c) => c.reopened).length },
    });
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
