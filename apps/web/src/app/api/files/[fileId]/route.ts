import { NextResponse } from "next/server";
import { eq, applications, files, stageProgress, submissions } from "@iclabs/db";
import { can } from "@iclabs/core";
import { db } from "@/server/db";
import { getSession } from "@/server/auth/session";
import { loadActor } from "@/server/auth/actor";
import { fileForDownload } from "@/server/storage/files";
import { fileStore } from "@/server/stages/deps";
import { reviewerUserIds } from "@/server/reviews/queue";

/**
 * Short-lived download link for a candidate file. Allowed for the owner, and for team members
 * who may read the submission it belongs to. Everyone else gets 404.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  const session = await getSession();
  const actor = session ? await loadActor(db(), session.user.id) : null;
  if (!actor) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const [f] = await db().select().from(files).where(eq(files.id, fileId));
  if (!f) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let allowed = actor.kind === "candidate" && f.ownerCandidateId === actor.candidateId;
  if (!allowed && actor.kind === "team") {
    const rows = await db()
      .select({ app: applications, submissionFiles: submissions.fileIds })
      .from(submissions)
      .innerJoin(stageProgress, eq(stageProgress.id, submissions.stageProgressId))
      .innerJoin(applications, eq(applications.id, stageProgress.applicationId))
      .where(eq(applications.candidateId, f.ownerCandidateId ?? ""));
    for (const { app, submissionFiles } of rows) {
      if (!submissionFiles.includes(fileId)) continue;
      allowed = can(actor, "read", {
        type: "submission",
        candidateId: app.candidateId,
        roleId: app.roleId,
        workflowId: app.workflowId,
        assignedReviewerIds: await reviewerUserIds(db(), app.id),
      });
      if (allowed) break;
    }
  }
  if (!allowed) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const result = await fileForDownload(db(), fileStore(), fileId);
  if (!result) return NextResponse.json({ error: "not_ready" }, { status: 409 });
  return NextResponse.redirect(result.url);
}
