import { eq, candidates, roleAssignments, teamMembers, users, type Db } from "@iclabs/db";
import type { Actor } from "@iclabs/core";

/** Builds the policy `Actor` for a signed-in user, or null if they have no valid identity. */
export async function loadActor(db: Db, userId: string): Promise<Actor | null> {
  const [user] = await db
    .select({ kind: users.kind, status: users.status, email: users.email })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) return null;
  const active = user.status === "active";

  if (user.kind === "candidate") {
    const [candidate] = await db
      .select({ id: candidates.id })
      .from(candidates)
      .where(eq(candidates.userId, userId));
    if (!candidate) return null;
    return { kind: "candidate", userId, candidateId: candidate.id, active };
  }

  const [member] = await db
    .select({ id: teamMembers.id, role: teamMembers.role, active: teamMembers.active })
    .from(teamMembers)
    .where(eq(teamMembers.userId, userId));
  if (!member) return null;
  const scopes = await db
    .select({ scope: roleAssignments.scope, scopeId: roleAssignments.scopeId })
    .from(roleAssignments)
    .where(eq(roleAssignments.teamMemberId, member.id));
  return {
    kind: "team",
    userId,
    role: member.role,
    active: active && member.active,
    roleIds: scopes.filter((s) => s.scope === "role").map((s) => s.scopeId),
    workflowIds: scopes.filter((s) => s.scope === "workflow").map((s) => s.scopeId),
  };
}
