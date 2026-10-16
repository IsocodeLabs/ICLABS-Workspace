import { roleAssignments, teamMembers, users, type Db } from "@iclabs/db";
import type { Actor, TeamRole } from "@iclabs/core";
import { loadActor } from "../server/auth/actor";

let counter = 0;

/** Creates a signed-in team member and returns their policy actor. */
export async function teamActor(
  db: Db,
  role: TeamRole,
  scopes: { roleIds?: string[]; workflowIds?: string[] } = {},
): Promise<Extract<Actor, { kind: "team" }> & { teamMemberId: string }> {
  const email = `${role}.${++counter}@isocodelabs.com`;
  const [user] = await db.insert(users).values({ email, name: role, kind: "team" }).returning();
  const [member] = await db
    .insert(teamMembers)
    .values({ email, role, userId: user!.id })
    .returning();
  for (const scopeId of scopes.roleIds ?? []) {
    await db.insert(roleAssignments).values({ teamMemberId: member!.id, scope: "role", scopeId });
  }
  for (const scopeId of scopes.workflowIds ?? []) {
    await db
      .insert(roleAssignments)
      .values({ teamMemberId: member!.id, scope: "workflow", scopeId });
  }
  const actor = await loadActor(db, user!.id);
  if (actor?.kind !== "team") throw new Error("fixture failed");
  return { ...actor, teamMemberId: member!.id };
}
