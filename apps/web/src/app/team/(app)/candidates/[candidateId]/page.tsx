import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Page, PageHeader } from "@/components/admin";
import { StatusPill } from "@/components/ui";
import { db } from "@/server/db";
import { requireTeam } from "@/server/auth/session";
import { getCandidateDetail } from "@/server/candidates/detail";
import { CandidateActions, RevokeButton } from "./candidate-actions";

const fmt = (d: Date | null) =>
  d
    ? d.toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";

export default async function CandidateDetailPage({
  params,
}: {
  params: Promise<{ candidateId: string }>;
}) {
  const { candidateId } = await params;
  const { actor } = await requireTeam(["admin", "hiring_manager"]);
  const detail = await getCandidateDetail(db(), actor, candidateId);
  if (!detail) notFound();
  const c = detail.candidate;
  const profile: [string, string | null][] = [
    ["Phone", c.phone],
    ["College", c.college],
    ["Graduation year", c.gradYear ? String(c.gradYear) : null],
    ["LinkedIn", c.linkedin],
    ["GitHub", c.github],
    ["Portfolio", c.portfolio],
    ["Skills", c.skills.join(", ") || null],
    ["Available", c.availableFrom ? `${c.availableFrom} → ${c.availableTo ?? "?"}` : null],
    ["Preferred start", c.preferredStart],
  ];
  return (
    <Page>
      <PageHeader
        title={c.name}
        subtitle={
          <>
            <Link href="/team/candidates" className="hover:underline">
              Candidates
            </Link>{" "}
            / {detail.email}
          </>
        }
        actions={
          actor.role === "admin" ? <CandidateActions candidateId={candidateId} /> : undefined
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <h2 className="mb-3 font-display text-lg font-semibold">Profile</h2>
          <dl className="space-y-2 text-[0.95rem]">
            {profile.map(([k, v]) => (
              <div key={k}>
                <dt className="text-sm text-muted">{k}</dt>
                <dd className="break-words">{v ?? "—"}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 space-y-1 text-sm text-muted">
            <div>
              Login:{" "}
              {detail.mustChangePassword
                ? `temporary password, expires ${fmt(detail.tempPasswordExpiresAt)}`
                : `active since ${fmt(detail.passwordChangedAt)}`}
            </div>
            <div>Email: {c.emailStatus === "ok" ? "OK" : c.emailStatus}</div>
            <div>Privacy consent: {c.consentAt ? fmt(c.consentAt) : "not yet"}</div>
          </div>
        </Card>
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <h2 className="mb-3 font-display text-lg font-semibold">Roles</h2>
            <ul className="divide-y divide-border">
              {detail.applications.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div>
                    <div className="font-semibold">{a.roleTitle}</div>
                    <div className="text-sm text-muted">Invited {fmt(a.invitedAt)}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusPill tone="neutral">{a.status.replaceAll("_", " ")}</StatusPill>
                    {!a.status.startsWith("closed") && (
                      <RevokeButton
                        applicationId={a.id}
                        candidateId={candidateId}
                        role={a.roleTitle}
                      />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <h2 className="mb-3 font-display text-lg font-semibold">Emails</h2>
            {detail.emails.length === 0 ? (
              <p className="text-muted">No emails yet.</p>
            ) : (
              <ul className="divide-y divide-border text-[0.95rem]">
                {detail.emails.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate">
                        {e.subject ?? e.templateKey.replaceAll("_", " ")}
                      </div>
                      <div className="text-sm text-muted">
                        {fmt(e.sentAt ?? e.createdAt)}
                        {e.lastError ? ` · ${e.lastError}` : ""}
                      </div>
                    </div>
                    <StatusPill
                      tone={
                        ["sent", "delivered"].includes(e.status)
                          ? "success"
                          : ["queued", "sending"].includes(e.status)
                            ? "neutral"
                            : "danger"
                      }
                    >
                      {e.status}
                    </StatusPill>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </Page>
  );
}
