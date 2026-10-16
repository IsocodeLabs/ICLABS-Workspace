import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { requireTeam } from "@/server/auth/session";
import { getBuilderData, listTemplates } from "@/server/hiring/structure";
import { Builder } from "./builder";

export default async function BuilderPage({ params }: { params: Promise<{ workflowId: string }> }) {
  const { workflowId } = await params;
  const { actor } = await requireTeam(["admin", "hiring_manager"]);
  const data = await getBuilderData(db(), actor, workflowId).catch(() => null);
  if (!data) notFound();
  const templates = (await listTemplates(db(), "workflow")).map((t) => ({
    id: t.id,
    name: t.name,
  }));
  // Remount when the server hands back a different draft (after publish or applying a template).
  return (
    <Builder key={`${data.draft?.id}:${data.published?.version}`} {...data} templates={templates} />
  );
}
