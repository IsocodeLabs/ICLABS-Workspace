import {
  and,
  desc,
  eq,
  inArray,
  applications,
  candidates,
  emailMessages,
  users,
  type Db,
} from "@iclabs/db";
import type { Actor } from "@iclabs/core";
import { assertCan, audit } from "../audit";
import type { EnqueueInput } from "../email/outbox";
import { resendInvite } from "./invites";

const ADMIN_ONLY = { type: "team_settings" } as const;

/**
 * Why someone on a track can't sign in yet:
 * - expired: never signed in and the temporary password ran out
 * - failed: the login email couldn't be sent (or was suppressed)
 * - never_sent: no login email on record
 * - pending: queued, not sent yet (scheduled invites)
 * - bounced: the address bounced or complained; a resend can't reach them
 */
export type LoginProblem = "expired" | "failed" | "never_sent" | "pending" | "bounced";

export type LoginCheckRow = {
  candidateId: string;
  name: string;
  email: string;
  problem: LoginProblem;
  lastEmail: Date | null;
};

const FAILED = new Set(["failed", "suppressed", "rejected", "bounced", "complained"]);
const PENDING = new Set(["queued", "sending"]);

/** Everyone on the track who doesn't have a working login, plus how many are fine. */
export async function loginCheck(
  db: Db,
  actor: Actor,
  workflowId: string,
  now = new Date(),
): Promise<{ total: number; signedIn: number; waiting: number; problems: LoginCheckRow[] }> {
  assertCan(actor, "manage", ADMIN_ONLY);
  const people = await db
    .selectDistinct({
      candidateId: candidates.id,
      userId: users.id,
      name: candidates.name,
      email: users.email,
      emailStatus: candidates.emailStatus,
      mustChange: users.mustChangePassword,
      expiresAt: users.tempPasswordExpiresAt,
    })
    .from(applications)
    .innerJoin(candidates, eq(candidates.id, applications.candidateId))
    .innerJoin(users, eq(users.id, candidates.userId))
    .where(
      and(
        eq(applications.workflowId, workflowId),
        eq(applications.testMode, false),
        inArray(applications.status, ["active", "needs_decision"]),
      ),
    );
  const ids = people.map((p) => p.userId);
  const emails = ids.length
    ? await db
        .select({
          userId: emailMessages.userId,
          status: emailMessages.status,
          at: emailMessages.createdAt,
          sentAt: emailMessages.sentAt,
        })
        .from(emailMessages)
        .where(and(inArray(emailMessages.userId, ids), eq(emailMessages.templateKey, "welcome")))
        .orderBy(desc(emailMessages.createdAt))
    : [];
  const latest = new Map<string, (typeof emails)[number]>();
  for (const e of emails) if (e.userId && !latest.has(e.userId)) latest.set(e.userId, e);

  let signedIn = 0;
  let waiting = 0;
  const problems: LoginCheckRow[] = [];
  for (const p of people) {
    if (!p.mustChange) {
      signedIn++;
      continue;
    }
    const last = latest.get(p.userId);
    let problem: LoginProblem | null = null;
    if (p.emailStatus !== "ok") problem = "bounced";
    else if (!last) problem = "never_sent";
    else if (PENDING.has(last.status)) problem = "pending";
    else if (FAILED.has(last.status)) problem = "failed";
    else if (p.expiresAt && p.expiresAt <= now) problem = "expired";
    if (!problem) {
      waiting++;
      continue;
    }
    problems.push({
      candidateId: p.candidateId,
      name: p.name,
      email: p.email,
      problem,
      lastEmail: last?.sentAt ?? last?.at ?? null,
    });
  }
  problems.sort((a, b) => a.problem.localeCompare(b.problem) || a.name.localeCompare(b.name));
  return { total: people.length, signedIn, waiting, problems };
}

/** Problems a fresh login email fixes. Pending ones are on their way; bounced can't be reached. */
export const RESENDABLE: readonly LoginProblem[] = ["expired", "failed", "never_sent"];

/**
 * New temporary password and welcome email for everyone on the track who can't sign in and can
 * be reached. When each email goes out, their unstarted steps are re-timed from it (outbox hook).
 */
export async function resendTrackLogins(
  db: Db,
  actor: Actor,
  workflowId: string,
  deps: { queueEmail: (input: EnqueueInput) => Promise<string>; loginUrl: string },
): Promise<{ resent: number }> {
  const { problems } = await loginCheck(db, actor, workflowId);
  const todo = problems.filter((p) => RESENDABLE.includes(p.problem));
  for (const p of todo) await resendInvite(db, actor, p.candidateId, deps);
  await audit(db, {
    actorUserId: actor.userId,
    action: "logins_resent",
    entity: "workflow",
    entityId: workflowId,
    after: { resent: todo.length },
  });
  return { resent: todo.length };
}
