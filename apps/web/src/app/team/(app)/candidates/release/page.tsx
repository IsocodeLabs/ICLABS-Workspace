import Link from "next/link";
import { EmptyState, Page, PageHeader } from "@/components/admin";
import { db } from "@/server/db";
import { requireTeam } from "@/server/auth/session";
import { listReleaseTracks } from "@/server/candidates/release-task";
import { ReleasePanel } from "./release-panel";

export default async function ReleaseTaskPage() {
  const { actor } = await requireTeam(["admin"]);
  const tracks = await listReleaseTracks(db(), actor);
  return (
    <Page>
      <PageHeader
        title="Release the task"
        subtitle="Opens the take-home task for everyone who has submitted their details and the written questions, with a one-week deadline, and emails them. You review the list first; nothing happens until you confirm."
        actions={
          <Link href="/team/candidates" className="text-sm font-semibold underline">
            Back to candidates
          </Link>
        }
      />
      {tracks.length === 0 ? (
        <EmptyState title="No track is ready" body="Publish a process with a task step first." />
      ) : (
        <ReleasePanel tracks={tracks} />
      )}
    </Page>
  );
}
