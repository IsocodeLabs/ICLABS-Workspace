import {
  eq,
  inArray,
  lt,
  or,
  sql,
  applications,
  candidates,
  cycles,
  emailMessages,
  files,
  users,
  workflows,
  type Db,
} from "@iclabs/db";
import type { Actor } from "@iclabs/core";
import { assertCan, audit } from "./audit";
import type { FileStore } from "./storage";

/** Candidate data is kept this long after a cycle closes (decided in Q&A; PRD R-PRIV). */
export const RETENTION_MONTHS = 12;

/**
 * Removes everything about one candidate: stored files, emails sent to them, their account and
 * (by cascade) applications, progress, submissions, reviews and interviews. The audit log keeps
 * an entry with no personal data.
 */
export async function eraseCandidate(
  db: Db,
  store: FileStore,
  candidateId: string,
  by: { actorUserId: string | null; via: "ui" | "system"; reason: string },
) {
  const [c] = await db
    .select({ userId: candidates.userId })
    .from(candidates)
    .where(eq(candidates.id, candidateId));
  if (!c) return false;
  const owned = await db
    .select({ key: files.objectKey })
    .from(files)
    .where(eq(files.ownerCandidateId, candidateId));
  for (const f of owned) {
    try {
      await store.remove(f.key);
    } catch (err) {
      // Keep going: the bucket's lifecycle rule removes orphans, and the row goes either way.
      console.error("[retention] file delete failed", err instanceof Error ? err.message : err);
    }
  }
  const appIds = (
    await db
      .select({ id: applications.id })
      .from(applications)
      .where(eq(applications.candidateId, candidateId))
  ).map((a) => a.id);
  // All or nothing: a failure must not leave a half-erased candidate behind.
  await db.transaction(async (tx) => {
    await tx
      .delete(emailMessages)
      .where(
        or(
          eq(emailMessages.userId, c.userId),
          appIds.length ? inArray(emailMessages.applicationId, appIds) : undefined,
        ),
      );
    await tx.delete(users).where(eq(users.id, c.userId));
  });
  await audit(db, {
    actorUserId: by.actorUserId,
    via: by.via,
    action: "candidate_erased",
    entity: "candidate",
    entityId: candidateId,
    after: { reason: by.reason, files: owned.length, applications: appIds.length },
  });
  return true;
}

/** Admin action for a data-deletion request (DPDP). */
export async function eraseCandidateOnRequest(
  db: Db,
  store: FileStore,
  actor: Actor,
  candidateId: string,
) {
  assertCan(actor, "manage", { type: "team_settings" });
  return eraseCandidate(db, store, candidateId, {
    actorUserId: actor.kind === "team" ? actor.userId : null,
    via: "ui",
    reason: "deletion_request",
  });
}

/**
 * Daily: erase candidates whose every application belongs to a cycle that closed more than
 * the retention period ago (or whose cycle has an explicit purge date that has passed), plus
 * candidates left with no applications for that long.
 */
export async function purgeExpired(db: Db, store: FileStore, now = new Date()) {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - RETENTION_MONTHS);
  const expiredCycles = await db
    .select({ id: cycles.id })
    .from(cycles)
    .where(
      sql`(${cycles.retentionPurgeAt} is not null and ${cycles.retentionPurgeAt} <= ${now.toISOString()})
        or (${cycles.status} in ('closed', 'archived')
            and coalesce(${cycles.closesAt}, ${cycles.updatedAt}) < ${cutoff.toISOString()})`,
    );
  const expired = new Set(expiredCycles.map((c) => c.id));

  const rows = await db
    .select({
      candidateId: candidates.id,
      createdAt: candidates.createdAt,
      cycleId: workflows.cycleId,
    })
    .from(candidates)
    .leftJoin(applications, eq(applications.candidateId, candidates.id))
    .leftJoin(workflows, eq(workflows.id, applications.workflowId))
    .where(
      or(
        lt(candidates.createdAt, cutoff),
        inArray(workflows.cycleId, expired.size ? [...expired] : [""]),
      ),
    );
  const byCandidate = new Map<string, { createdAt: Date; cycles: (string | null)[] }>();
  for (const r of rows) {
    const e = byCandidate.get(r.candidateId) ?? { createdAt: r.createdAt, cycles: [] };
    e.cycles.push(r.cycleId);
    byCandidate.set(r.candidateId, e);
  }
  let erased = 0;
  for (const [candidateId, e] of byCandidate) {
    // Re-check against all of the candidate's applications, not only the ones the filter matched.
    const all = await db
      .select({ cycleId: workflows.cycleId })
      .from(applications)
      .innerJoin(workflows, eq(workflows.id, applications.workflowId))
      .where(eq(applications.candidateId, candidateId));
    const due = all.length === 0 ? e.createdAt < cutoff : all.every((a) => expired.has(a.cycleId));
    if (
      due &&
      (await eraseCandidate(db, store, candidateId, {
        actorUserId: null,
        via: "system",
        reason: "retention",
      }))
    )
      erased++;
  }
  return erased;
}
