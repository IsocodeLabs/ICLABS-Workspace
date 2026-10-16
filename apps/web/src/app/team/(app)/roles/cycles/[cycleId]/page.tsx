import Link from "next/link";
import { notFound } from "next/navigation";
import { Workflow } from "lucide-react";
import { Card, Page, PageHeader } from "@/components/admin";
import { StatusPill } from "@/components/ui";
import { db } from "@/server/db";
import { requireTeam } from "@/server/auth/session";
import { getCycleDetail } from "@/server/hiring/structure";
import { CreateTrackForm } from "../../forms";
import { CycleControls } from "./cycle-controls";

export default async function CyclePage({ params }: { params: Promise<{ cycleId: string }> }) {
  const { cycleId } = await params;
  const { actor } = await requireTeam(["admin", "hiring_manager"]);
  const detail = await getCycleDetail(db(), actor, cycleId).catch(() => null);
  if (!detail) notFound();
  const { cycle, role, tracks } = detail;

  return (
    <Page>
      <PageHeader
        title={`${role.title} · ${cycle.name}`}
        subtitle={
          <>
            <Link href="/team/roles" className="hover:underline">
              Roles
            </Link>{" "}
            / {role.title}
          </>
        }
        actions={
          <CycleControls
            cycleId={cycle.id}
            status={cycle.status}
            isAdmin={actor.role === "admin"}
          />
        }
      />
      <div className="grid gap-4 md:grid-cols-2">
        {tracks.map((t) => (
          <Card key={t.id}>
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold">{t.name}</h2>
              <StatusPill tone={t.publishedVersionId ? "success" : "neutral"}>
                {t.publishedVersionId ? "Published" : "Draft only"}
              </StatusPill>
            </div>
            <Link
              href={`/team/builder/${t.id}`}
              className="mt-4 inline-flex items-center gap-2 rounded-xl px-4 py-2 font-semibold text-white"
              style={{ background: "var(--accent-gradient)" }}
            >
              <Workflow size={18} aria-hidden /> Open Process Builder
            </Link>
          </Card>
        ))}
      </div>
      <div className="mt-6 max-w-lg">
        <CreateTrackForm cycleId={cycle.id} />
      </div>
    </Page>
  );
}
