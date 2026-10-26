import Link from "next/link";
import { EmptyState, Page, PageHeader } from "@/components/admin";
import { db } from "@/server/db";
import { requireTeam } from "@/server/auth/session";
import { listAnnouncementTracks } from "@/server/candidates/announce";
import { LoginPanel } from "./login-panel";

export default async function LoginCheckPage() {
  const { actor } = await requireTeam(["admin"]);
  const tracks = await listAnnouncementTracks(db(), actor);
  return (
    <Page>
      <PageHeader
        title="Login check"
        subtitle="Who on a track can't sign in yet, and why. You see the list first, and nothing is sent until you confirm."
        actions={
          <Link href="/team/candidates" className="text-sm font-semibold underline">
            Back to candidates
          </Link>
        }
      />
      {tracks.length === 0 ? (
        <EmptyState title="No published processes" body="Publish a process first." />
      ) : (
        <LoginPanel tracks={tracks.map((t) => ({ workflowId: t.workflowId, label: t.label }))} />
      )}
    </Page>
  );
}
