import Link from "next/link";
import { EmptyState, Page, PageHeader } from "@/components/admin";
import { db } from "@/server/db";
import { requireTeam } from "@/server/auth/session";
import { extensionTracks } from "@/server/candidates/final-extension";
import { FinalExtensionPanel } from "./final-extension-panel";

export default async function FinalExtensionPage() {
  const { actor } = await requireTeam(["admin"]);
  const tracks = (await extensionTracks(db(), actor)).filter((t) => t.nodes.length > 0);
  return (
    <Page>
      <PageHeader
        title="Final extension"
        subtitle="Move the closing time of chosen steps to one date for everyone still in the process. You see the full list first, nothing changes until you confirm, and no email is sent."
        actions={
          <Link href="/team/candidates" className="text-sm font-semibold underline">
            Back to candidates
          </Link>
        }
      />
      {tracks.length === 0 ? (
        <EmptyState title="No tracks with candidates" body="Invite candidates first." />
      ) : (
        <FinalExtensionPanel tracks={tracks} />
      )}
    </Page>
  );
}
