import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Actor, TeamRole } from "@iclabs/core";
import { db } from "../db";
import { loadActor } from "./actor";
import { auth } from "./index";

export async function getSession() {
  // Read request headers first: it marks the page dynamic before any secret is needed.
  const requestHeaders = await headers();
  return auth().api.getSession({ headers: requestHeaders });
}

type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>;

/**
 * Guards every candidate page and action. Until the first-login password change is done,
 * the only reachable page is /change-password.
 */
export async function requireCandidate(
  opts: { passwordChangePage?: boolean } = {},
): Promise<{ session: Session; actor: Extract<Actor, { kind: "candidate" }> }> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.user.kind !== "candidate") redirect("/team");
  if (session.user.mustChangePassword && !opts.passwordChangePage) redirect("/change-password");
  if (!session.user.mustChangePassword && opts.passwordChangePage) redirect("/dashboard");
  const actor = await loadActor(db(), session.user.id);
  if (actor?.kind !== "candidate" || !actor.active) redirect("/login");
  return { session, actor };
}

export async function requireTeam(
  roles?: TeamRole[],
): Promise<{ session: Session; actor: Extract<Actor, { kind: "team" }> }> {
  const session = await getSession();
  if (!session) redirect("/team/login");
  if (session.user.kind !== "team") redirect("/dashboard");
  const actor = await loadActor(db(), session.user.id);
  if (actor?.kind !== "team" || !actor.active) redirect("/team/login?error=not_allowed");
  if (roles && !roles.includes(actor.role)) redirect("/team?error=forbidden");
  return { session, actor };
}
