import Link from "next/link";
import { Card, EmptyState, Page, PageHeader } from "@/components/admin";
import { StatusPill } from "@/components/ui";
import { db } from "@/server/db";
import { requireTeam } from "@/server/auth/session";
import { listRolesWithCycles } from "@/server/hiring/structure";
import { CreateCycleForm, CreateRoleForm } from "./forms";

const cycleTone = {
  draft: "neutral",
  open: "success",
  closed: "warning",
  archived: "neutral",
} as const;

export default async function RolesPage() {
  const { actor } = await requireTeam(["admin", "hiring_manager"]);
  const roles = await listRolesWithCycles(db(), actor);
  return (
    <Page>
      <PageHeader
        title="Roles & processes"
        subtitle="Each role runs in hiring rounds. Each round has one or more tracks, and each track has its own process."
      />
      {actor.role === "admin" && <CreateRoleForm />}
      {roles.length === 0 ? (
        <EmptyState title="No roles yet" body="Create the first role above, e.g. SDE Intern." />
      ) : (
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {roles.map(({ role, cycles }) => (
            <Card key={role.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-display text-xl font-semibold">{role.title}</h2>
                  <p className="text-sm text-muted">
                    {role.seats ? `${role.seats} seats` : "Seats not set"} · /{role.slug}
                  </p>
                </div>
              </div>
              <ul className="mt-4 divide-y divide-border">
                {cycles.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/team/roles/cycles/${c.id}`}
                      className="flex items-center justify-between py-2.5 hover:text-brand-600"
                    >
                      <span className="font-medium">{c.name}</span>
                      <StatusPill tone={cycleTone[c.status]}>
                        {c.status[0]!.toUpperCase() + c.status.slice(1)}
                      </StatusPill>
                    </Link>
                  </li>
                ))}
              </ul>
              <CreateCycleForm roleId={role.id} />
            </Card>
          ))}
        </div>
      )}
    </Page>
  );
}
