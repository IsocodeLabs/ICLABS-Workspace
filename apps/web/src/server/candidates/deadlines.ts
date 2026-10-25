import {
  and,
  eq,
  inArray,
  applications,
  candidates,
  stageProgress,
  users,
  type Db,
} from "@iclabs/db";
import type { Actor } from "@iclabs/core";
import { assertCan, audit } from "../audit";

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
