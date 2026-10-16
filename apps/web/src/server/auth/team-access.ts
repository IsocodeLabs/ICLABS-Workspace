import { and, eq, teamMembers, users, type Db } from "@iclabs/db";

/**
 * Gate for Google sign-ups: Better Auth only creates users through Google (candidates are
 * created by the invite service), so every new user here must be on the team allow-list.
 */
export async function allowTeamSignUp(db: Db, email: string, teamDomain: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  if (!normalized.endsWith(`@${teamDomain.toLowerCase()}`)) return false;
  const [member] = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(and(eq(teamMembers.email, normalized), eq(teamMembers.active, true)));
  return member !== undefined;
}

/**
 * Gate for every new session: disabled users never get one, and team users need an active
 * allow-list entry (so removing someone from the team locks them out on their next sign-in).
 * Links the allow-list row to the user on first sign-in.
 */
export async function allowSession(db: Db, userId: string, teamDomain: string): Promise<boolean> {
  const [user] = await db
    .select({ email: users.email, kind: users.kind, status: users.status })
    .from(users)
    .where(eq(users.id, userId));
  if (!user || user.status !== "active") return false;
  if (user.kind === "candidate") return true;

  const email = user.email.toLowerCase();
  if (!email.endsWith(`@${teamDomain.toLowerCase()}`)) return false;
  const [member] = await db
    .select({ id: teamMembers.id, userId: teamMembers.userId, active: teamMembers.active })
    .from(teamMembers)
    .where(eq(teamMembers.email, email));
  if (!member?.active) return false;
  if (member.userId === null) {
    await db.update(teamMembers).set({ userId }).where(eq(teamMembers.id, member.id));
  } else if (member.userId !== userId) {
    return false;
  }
  return true;
}
