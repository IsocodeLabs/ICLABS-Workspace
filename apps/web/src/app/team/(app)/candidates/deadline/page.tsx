import Link from "next/link";
import { EmptyState, Page, PageHeader } from "@/components/admin";
import { db } from "@/server/db";
import { requireTeam } from "@/server/auth/session";
import { listAnnouncementTracks } from "@/server/candidates/announce";
import { DeadlinePanel } from "./deadline-panel";
import { LoginRestartPanel } from "./login-restart-panel";

export default async function StepDeadlinePage() {
  const { actor } = await requireTeam(["admin"]);
  const tracks = (await listAnnouncementTracks(db(), actor)).filter((t) => t.nodes.length > 0);
  return (
    <Page>
      <PageHeader
        title="Deadlines"
        subtitle="Give everyone at a step the same dates, whenever they reached it. You see the full list and their current dates first, and nothing changes until you confirm."
        actions={
          <Link href="/team/candidates" className="text-sm font-semibold underline">
            Back to candidates
          </Link>
        }
      />
      {tracks.length === 0 ? (
        <EmptyState title="No published processes" body="Publish a process first." />
      ) : (
        <div className="space-y-8">
          <LoginRestartPanel tracks={tracks} />
          <DeadlinePanel tracks={tracks} />
        </div>
      )}
    </Page>
  );
}
