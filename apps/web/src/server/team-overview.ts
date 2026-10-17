import { and, eq, applications, reviewAssignments, teamMembers, type Db } from "@iclabs/db";
import { can, type Actor } from "@iclabs/core";
import { env } from "./env";
import { interviewBoard } from "./interviews";
import { listRolesWithCycles } from "./hiring/structure";
import { listTracks } from "./reviews/decisions";

type TeamActor = Actor & { kind: "team" };

/** Small numbers for the sidebar badges. Cheap enough to run on every page. */
export async function navCounts(db: Db, actor: TeamActor) {
  const mine = await db
    .select({ id: reviewAssignments.id })
    .from(reviewAssignments)
    .innerJoin(teamMembers, eq(teamMembers.id, reviewAssignments.reviewerId))
    .where(and(eq(teamMembers.userId, actor.userId), eq(reviewAssignments.status, "assigned")));
  let decisions = 0;
  if (actor.role === "admin" || actor.role === "hiring_manager") {
    const rows = await db
      .select({ roleId: applications.roleId, workflowId: applications.workflowId })
      .from(applications)
      .where(eq(applications.status, "needs_decision"));
    decisions = rows.filter((r) => can(actor, "read", { type: "workflow", roleId: r.roleId, workflowId: r.workflowId })).length;
  }
  return { reviews: mine.length, decisions };
}

export type AttentionItem = { href: string; title: string; detail: string; count: number };
export type SetupStep = { label: string; href: string; done: boolean; hint: string };

/** What needs the signed-in person's attention right now, plus first-run setup progress. */
export async function teamOverview(db: Db, actor: TeamActor) {
  const manages = actor.role === "admin" || actor.role === "hiring_manager";
  const counts = await navCounts(db, actor);
  const items: AttentionItem[] = [];
  if (counts.reviews)
    items.push({ href: "/team/reviews", title: "Reviews waiting for you", detail: "Score submissions assigned to you", count: counts.reviews });
  if (manages && counts.decisions)
    items.push({ href: "/team/pipeline", title: "Candidates need a decision", detail: "Missed deadlines and borderline results", count: counts.decisions });
  if (manages) {
    const board = await interviewBoard(db, actor);
    if (board.ready.length)
      items.push({ href: "/team/interviews", title: "Ready to schedule an interview", detail: "Book a time with the panel", count: board.ready.length });
    const awaiting = board.upcoming.filter((i) => i.endsAt < new Date()).length;
    if (awaiting) items.push({ href: "/team/interviews", title: "Interviews to close out", detail: "Mark them done or no-show", count: awaiting });
  }

  let setup: SetupStep[] = [];
  if (actor.role === "admin") {
    const [roles, tracks, members, candidateRows] = await Promise.all([
      listRolesWithCycles(db, actor),
      listTracks(db, actor),
      db.select({ id: teamMembers.id }).from(teamMembers).where(eq(teamMembers.active, true)),
      db.select({ id: applications.id }).from(applications).limit(1),
    ]);
    setup = [
      { label: "Add your roles", href: "/team/roles", done: roles.length > 0, hint: "BDI, SDE and PM interns, each with a hiring round" },
      { label: "Design and publish a process", href: "/team/roles", done: tracks.length > 0, hint: "Drag stages onto the canvas, then publish" },
      { label: "Add your team", href: "/team/settings/team", done: members.length > 1, hint: "Reviewers, hiring managers and interviewers" },
      { label: "Turn on real email", href: "/team/settings/emails", done: env().EMAIL_TRANSPORT !== "log", hint: "Needed for invites and sign-in codes" },
      { label: "Invite your first candidates", href: "/team/candidates", done: candidateRows.length > 0, hint: "One by one, or upload a CSV" },
    ];
  }
  return { items, setup };
}
