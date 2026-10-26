import Link from "next/link";
import { Card, EmptyState, Page, PageHeader } from "@/components/admin";
import { StatusPill, type Tone } from "@/components/ui";
import { db } from "@/server/db";
import { requireTeam } from "@/server/auth/session";
import { listCandidatesForTeam } from "@/server/candidates/invites";
import { listRolesWithCycles } from "@/server/hiring/structure";
import { InvitePanel } from "./invite-panel";

const statusTone: Record<string, Tone> = {
  active: "neutral",
  needs_decision: "warning",
  on_hold: "warning",
  interview_scheduled: "success",
  completed: "success",
  closed_rejected: "neutral",
  closed_withdrawn: "neutral",
};

function loginState(r: {
  mustChangePassword: boolean;
  passwordChangedAt: Date | null;
  tempPasswordExpiresAt: Date | null;
}) {
  if (!r.mustChangePassword && r.passwordChangedAt)
    return { label: "Active", tone: "success" as const };
  if (r.tempPasswordExpiresAt && r.tempPasswordExpiresAt < new Date())
    return { label: "Invite expired", tone: "danger" as const };
  return { label: "Invited", tone: "neutral" as const };
}

export default async function CandidatesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { actor } = await requireTeam(["admin", "hiring_manager"]);
  const { q } = await searchParams;
  const [rows, roles] = await Promise.all([
    listCandidatesForTeam(db(), actor, q),
    listRolesWithCycles(db(), actor),
  ]);
  return (
    <Page>
      <PageHeader
        title="Candidates"
        subtitle="Invite shortlisted candidates one at a time or from a careers-site CSV."
        actions={
          actor.role === "admin" ? (
            <div className="flex gap-4">
              <Link href="/team/candidates/logins" className="text-sm font-semibold underline">
                Login check
              </Link>
              <Link href="/team/candidates/deadline" className="text-sm font-semibold underline">
                Deadlines
              </Link>
              <Link href="/team/candidates/message" className="text-sm font-semibold underline">
                Message candidates
              </Link>
            </div>
          ) : undefined
        }
      />
      <InvitePanel roles={roles.map((r) => ({ slug: r.role.slug, title: r.role.title }))} />
      <form className="mt-8 mb-4 max-w-md">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search name or email"
          aria-label="Search candidates"
          className="w-full rounded-xl border border-border bg-surface px-3 py-2"
        />
      </form>
      {rows.length === 0 ? (
        <EmptyState
          title="No candidates yet"
          body="Invited candidates appear here with their login and process status."
        />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-[0.95rem]">
            <thead className="border-b border-border text-sm text-muted">
              <tr>
                <th className="px-5 py-3 font-semibold">Candidate</th>
                <th className="px-5 py-3 font-semibold">Role</th>
                <th className="px-5 py-3 font-semibold">Process</th>
                <th className="px-5 py-3 font-semibold">Login</th>
                <th className="px-5 py-3 font-semibold">Email</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => {
                const login = loginState(r);
                return (
                  <tr key={r.applicationId}>
                    <td className="px-5 py-3">
                      <Link
                        href={`/team/candidates/${r.candidateId}`}
                        className="font-semibold hover:underline"
                      >
                        {r.name}
                      </Link>
                      <div className="text-sm text-muted">{r.email}</div>
                    </td>
                    <td className="px-5 py-3">{r.roleTitle}</td>
                    <td className="px-5 py-3">
                      <StatusPill tone={statusTone[r.status] ?? "neutral"}>
                        {r.status.replaceAll("_", " ")}
                      </StatusPill>
                    </td>
                    <td className="px-5 py-3">
                      <StatusPill tone={login.tone}>{login.label}</StatusPill>
                    </td>
                    <td className="px-5 py-3">
                      <StatusPill tone={r.emailStatus === "ok" ? "success" : "danger"}>
                        {r.emailStatus === "ok"
                          ? "OK"
                          : r.emailStatus === "bounced"
                            ? "Bounced"
                            : "Marked spam"}
                      </StatusPill>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </Page>
  );
}
