import { EmptyState, Page, PageHeader } from "@/components/admin";
import { db } from "@/server/db";
import { requireTeam } from "@/server/auth/session";
import { getPipeline, listTracks } from "@/server/reviews/decisions";
import { PipelineBoard } from "./board";
import { TrackPicker } from "./track-picker";

export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ track?: string; select?: string; action?: string; target?: string }> }) {
  const { actor } = await requireTeam(["admin", "hiring_manager"]);
  const tracks = await listTracks(db(), actor);
  const { track: wanted, select, action, target } = await searchParams;
  // A bulk decision prepared by Claude (MCP) opens pre-filled; nothing runs until confirmed.
  const prepared =
    select && (action === "advance" || action === "hold" || action === "reject")
      ? { ids: select.split(",").slice(0, 200), action: action as "advance" | "hold" | "reject", target: target ?? null }
      : null;
  const current = tracks.find((t) => t.id === wanted) ?? tracks[0];
  const data = current ? await getPipeline(db(), actor, current.id) : null;

  return (
    <Page wide>
      <PageHeader
        title="Pipeline"
        subtitle="Where everyone stands. Click a card to decide, or select several for bulk actions."
        actions={
          tracks.length > 0 && (
            <TrackPicker
              value={current?.id ?? ""}
              options={tracks.map((t) => ({ id: t.id, label: `${t.roleTitle} · ${t.cycleName} · ${t.name}` }))}
            />
          )
        }
      />
      {!current || !data ? (
        <EmptyState title="No published processes yet" body="Publish a process in Roles & processes, then invite candidates." />
      ) : (
        <PipelineBoard
          workflowId={current.id}
          nodes={data.nodes}
          cards={data.cards.map((c) => ({ ...c, invitedAt: c.invitedAt.toISOString(), dueAt: c.dueAt?.toISOString() ?? null }))}
          isAdmin={actor.role === "admin"}
          prepared={prepared}
        />
      )}
    </Page>
  );
}
