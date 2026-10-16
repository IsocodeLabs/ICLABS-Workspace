import { and, eq, roleAssignments, teamMembers, type Db } from "@iclabs/db";
import type { Actor, TeamRole } from "@iclabs/core";
import { assertCan, audit } from "../audit";

const ADMIN_ONLY = { type: "team_settings" } as const;

export async function listTeam(db: Db, actor: Actor) {
  assertCan(actor, "manage", ADMIN_ONLY);
  const members = await db.select().from(teamMembers).orderBy(teamMembers.email);
  const scopes = await db.select().from(roleAssignments);
  return members.map((m) => ({ ...m, scopes: scopes.filter((s) => s.teamMemberId === m.id) }));
}

/** Adds someone to the Google sign-in allow-list. */
export async function addTeamMember(
  db: Db,
  actor: Actor,
  input: { email: string; role: TeamRole; teamDomain: string },
) {
  assertCan(actor, "manage", ADMIN_ONLY);
  const email = input.email.trim().toLowerCase();
  if (!email.endsWith(`@${input.teamDomain}`))
    throw new Error(`Team members need an @${input.teamDomain} email`);
  const [member] = await db
    .insert(teamMembers)
    .values({ email, role: input.role })
    .onConflictDoUpdate({ target: teamMembers.email, set: { role: input.role, active: true } })
    .returning();
  await audit(db, {
    actorUserId: actor.userId,
    action: "team_member_added",
    entity: "team_member",
    entityId: member!.id,
    after: { email, role: input.role },
  });
  return member!;
}

export async function updateTeamMember(
  db: Db,
  actor: Actor,
  input: { id: string; role?: TeamRole; active?: boolean },
) {
  assertCan(actor, "manage", ADMIN_ONLY);
  if (input.id && actor.kind === "team") {
    const [self] = await db.select().from(teamMembers).where(eq(teamMembers.userId, actor.userId));
    if (
      self?.id === input.id &&
      (input.active === false || (input.role && input.role !== "admin"))
    ) {
      throw new Error("You can't remove your own admin access");
    }
  }
  const { id, ...patch } = input;
  await db.update(teamMembers).set(patch).where(eq(teamMembers.id, id));
  await audit(db, {
    actorUserId: actor.userId,
    action: "team_member_updated",
    entity: "team_member",
    entityId: id,
    after: patch,
  });
}

/** Scope a hiring manager to roles or tracks. */
export async function setAssignment(
  db: Db,
  actor: Actor,
  input: { teamMemberId: string; scope: "role" | "workflow"; scopeId: string; assigned: boolean },
) {
  assertCan(actor, "manage", ADMIN_ONLY);
  const { teamMemberId, scope, scopeId } = input;
  if (input.assigned) {
    await db.insert(roleAssignments).values({ teamMemberId, scope, scopeId }).onConflictDoNothing();
  } else {
    await db
      .delete(roleAssignments)
      .where(
        and(
          eq(roleAssignments.teamMemberId, teamMemberId),
          eq(roleAssignments.scope, scope),
          eq(roleAssignments.scopeId, scopeId),
        ),
      );
  }
}
