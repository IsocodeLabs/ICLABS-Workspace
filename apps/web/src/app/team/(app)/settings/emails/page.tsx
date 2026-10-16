import { Page, PageHeader } from "@/components/admin";
import { db } from "@/server/db";
import { requireTeam } from "@/server/auth/session";
import { listEmailTemplates } from "@/server/candidates/detail";
import { TemplateEditor } from "./template-editor";

export default async function EmailTemplatesPage() {
  const { actor } = await requireTeam(["admin"]);
  const templates = await listEmailTemplates(db(), actor);
  return (
    <Page>
      <PageHeader
        title="Email templates"
        subtitle="Edit the wording candidates receive. Use {{variables}} as shown; blank lines start a new paragraph."
      />
      <div className="space-y-4">
        {templates.map((t) => (
          <TemplateEditor key={t.key} template={t} />
        ))}
      </div>
    </Page>
  );
}
