import "server-only";
import { candidates, eq, teamMembers } from "@iclabs/db";
import { db } from "../db";
import { env } from "../env";
import { getSession } from "../auth/session";
import { appUrl, queueEmail } from "../email";
import { recordError, type ErrorReport, type ErrorReporter } from "./alerts";

/** The signed-in person, as the alert names them; null when nobody is signed in. */
export async function currentReporter(): Promise<ErrorReporter | null> {
  const session = await getSession().catch(() => null);
  if (!session) return null;
  const user = session.user;
  if (user.kind === "candidate") {
    const [c] = await db()
      .select({ name: candidates.name })
      .from(candidates)
      .where(eq(candidates.userId, user.id));
    return { userId: user.id, name: c?.name ?? user.name, email: user.email, kind: "candidate" };
  }
  const [m] = await db()
    .select({ role: teamMembers.role })
    .from(teamMembers)
    .where(eq(teamMembers.userId, user.id));
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    kind: `team, ${m?.role ?? "member"}`,
  };
}

export async function reportToTeam(report: ErrorReport): Promise<void> {
  try {
    await recordError(db(), report, await currentReporter(), {
      queueEmail,
      to: env().ERROR_ALERT_EMAIL,
    });
  } catch (e) {
    console.error("[errors] couldn't record", (e as Error).message);
  }
}

/**
 * For server actions that catch an error and show a friendly message instead: the real cause
 * goes to the team (logged and emailed), never to the screen.
 */
export async function reportServerError(where: string, err: unknown, shown: string, path = "/") {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  console.error(`[${where}]`, message);
  await reportToTeam({ kind: "crash", message, shown, where, url: appUrl(path) });
}
