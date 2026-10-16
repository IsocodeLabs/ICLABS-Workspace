import { Card, Page, PageHeader } from "@/components/admin";
import { db } from "@/server/db";
import { requireTeam } from "@/server/auth/session";
import { listRolesWithCycles } from "@/server/hiring/structure";
import { listTeam } from "@/server/team/members";
import { AddMemberForm, MemberRow } from "./team-forms";

export default async function TeamSettingsPage() {
  const { actor } = await requireTeam(["admin"]);
  const [members, roles] = await Promise.all([
    listTeam(db(), actor),
    listRolesWithCycles(db(), actor),
  ]);
  return (
    <Page>
      <PageHeader
        title="Team"
        subtitle="Only people listed here can sign in with Google. Hiring managers only see the roles you assign them."
      />
      <AddMemberForm />
      <Card className="mt-6 overflow-x-auto p-0">
        <table className="w-full text-left text-[0.95rem]">
          <thead className="border-b border-border text-sm text-muted">
            <tr>
              <th className="px-5 py-3 font-semibold">Email</th>
              <th className="px-5 py-3 font-semibold">Role</th>
              <th className="px-5 py-3 font-semibold">Manages</th>
              <th className="px-5 py-3 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {members.map((m) => (
              <MemberRow
                key={m.id}
                member={{
                  id: m.id,
                  email: m.email,
                  role: m.role,
                  active: m.active,
                  signedIn: m.userId !== null,
                }}
                roleOptions={roles.map((r) => ({ id: r.role.id, title: r.role.title }))}
                assignedRoleIds={m.scopes.filter((s) => s.scope === "role").map((s) => s.scopeId)}
              />
            ))}
          </tbody>
        </table>
      </Card>
    </Page>
  );
}
