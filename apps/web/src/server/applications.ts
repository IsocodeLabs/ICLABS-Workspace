import { eq, applications, roles, type Db } from "@iclabs/db";
import { can, type Actor } from "@iclabs/core";

export type ApplicationCard = {
  id: string;
  roleId: string;
  roleTitle: string;
  status: (typeof applications.$inferSelect)["status"];
};

/**
 * Applications the actor may see. Candidates are narrowed in SQL to their own rows;
 * everything is then checked with `can()` so the policy layer has the final word.
 */
export async function listApplicationsForActor(db: Db, actor: Actor): Promise<ApplicationCard[]> {
  const base = db
    .select({
      id: applications.id,
      roleId: applications.roleId,
      roleTitle: roles.title,
      workflowId: applications.workflowId,
      candidateId: applications.candidateId,
      status: applications.status,
    })
    .from(applications)
    .innerJoin(roles, eq(roles.id, applications.roleId));
  const rows =
    actor.kind === "candidate"
      ? await base.where(eq(applications.candidateId, actor.candidateId))
      : await base;

  return rows
    .filter((r) =>
      can(actor, "read", {
        type: "application",
        candidateId: r.candidateId,
        roleId: r.roleId,
        workflowId: r.workflowId,
        status: r.status,
        // Reviewer and interviewer assignments arrive with M5/M6.
        reviewerIds: [],
        interviewerIds: [],
      }),
    )
    .map(({ id, roleId, roleTitle, status }) => ({ id, roleId, roleTitle, status }));
}
