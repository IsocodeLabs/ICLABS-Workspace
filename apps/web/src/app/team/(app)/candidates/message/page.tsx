import Link from "next/link";
import { EmptyState, Page, PageHeader } from "@/components/admin";
import { db } from "@/server/db";
import { requireTeam } from "@/server/auth/session";
import { ANNOUNCEMENTS, listAnnouncementTracks } from "@/server/candidates/announce";
import { MessagePanel } from "./message-panel";

export default async function MessageCandidatesPage() {
  const { actor } = await requireTeam(["admin"]);
  const tracks = (await listAnnouncementTracks(db(), actor)).filter((t) => t.nodes.length > 0);
  return (
    <Page>
      <PageHeader
        title="Message candidates"
        subtitle="Email everyone at a step. You review the email and the full list first, and nothing is sent until you confirm."
        actions={
          <Link href="/team/candidates" className="text-sm font-semibold underline">
            Back to candidates
          </Link>
        }
      />
      {tracks.length === 0 ? (
        <EmptyState title="No published processes" body="Publish a process first." />
      ) : (
        <MessagePanel
          tracks={tracks}
          kinds={Object.entries(ANNOUNCEMENTS).map(([key, v]) => ({
            key,
            label: v.label,
            audience: v.audience,
            anyStep: v.group === "pipeline",
          }))}
        />
      )}
    </Page>
  );
}
