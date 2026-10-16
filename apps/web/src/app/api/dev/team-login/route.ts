import { NextResponse, type NextRequest } from "next/server";
import { and, eq, teamMembers, users } from "@iclabs/db";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { devTeamLoginEnabled } from "@/server/env";

/**
 * LOCAL DEVELOPMENT ONLY. Signs in an allow-listed team member without Google so the team
 * app can be exercised on a laptop and in E2E tests. 404 unless NODE_ENV=development and
 * DEV_TEAM_LOGIN=true; the session still passes the normal allow-list check.
 */
export async function GET(req: NextRequest) {
  if (!devTeamLoginEnabled()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const email = req.nextUrl.searchParams.get("email")?.toLowerCase() ?? "";
  const [member] = await db()
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.email, email), eq(teamMembers.active, true)));
  if (!member) return NextResponse.json({ error: "not on the team list" }, { status: 403 });

  let userId = member.userId;
  if (!userId) {
    const [user] = await db()
      .insert(users)
      .values({ email, name: email.split("@")[0]!, kind: "team", emailVerified: true })
      .onConflictDoNothing()
      .returning();
    userId = user?.id ?? (await db().select().from(users).where(eq(users.email, email)))[0]!.id;
    // The test login skips session hooks, so link the allow-list entry here (as allowSession would).
    await db().update(teamMembers).set({ userId }).where(eq(teamMembers.id, member.id));
  }

  const ctx = (await auth().$context) as unknown as {
    test: {
      login: (o: { userId: string }) => Promise<{ cookies: { name: string; value: string }[] }>;
    };
  };
  const { cookies } = await ctx.test.login({ userId });
  const res = NextResponse.redirect(new URL("/team", req.url));
  for (const c of cookies)
    res.cookies.set(c.name, c.value, { httpOnly: true, sameSite: "lax", path: "/" });
  return res;
}
