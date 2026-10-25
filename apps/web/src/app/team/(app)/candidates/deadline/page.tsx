import Link from "next/link";
import { EmptyState, Page, PageHeader } from "@/components/admin";
import { db } from "@/server/db";
import { requireTeam } from "@/server/auth/session";
import { listAnnouncementTracks } from "@/server/candidates/announce";
import { DeadlinePanel } from "./deadline-panel";

export default async function StepDeadlinePage() {
  const { actor } = await requireTeam(["admin"]);
  const tracks = (await listAnnouncementTracks(db(), actor)).filter((t) => t.nodes.length > 0);
  return (
    <Page>
      <PageHeader
        title="Same deadline for everyone"
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
        <DeadlinePanel tracks={tracks} />
      )}
    </Page>
  );
}
