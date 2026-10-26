"use client";

import { useState, useTransition } from "react";
import { Btn, Card, Field, Select } from "@/components/admin";
import { ConfirmDialog } from "@/components/dialog";
import { Alert, StatusPill } from "@/components/ui";
import { loginCheckAction, resendLoginsAction, type LoginCheckView } from "./actions";

type Track = { workflowId: string; label: string };

const PROBLEM: Record<string, { label: string; tone: "danger" | "warning" | "neutral" }> = {
  expired: { label: "Password expired, never signed in", tone: "warning" },
  failed: { label: "Login email failed", tone: "danger" },
  never_sent: { label: "No login email sent", tone: "danger" },
  pending: { label: "Login email queued", tone: "neutral" },
  bounced: { label: "Address bounced", tone: "danger" },
};

export function LoginPanel({ tracks }: { tracks: Track[] }) {
  const [workflowId, setWorkflowId] = useState(tracks[0]?.workflowId ?? "");
  const [view, setView] = useState<LoginCheckView | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const check = () =>
    start(async () => {
      setMessage(null);
      setView(await loginCheckAction({ workflowId }));
    });

  return (
    <div className="space-y-6">
      <Card>
        <Field label="Track" htmlFor="lc-track">
          <Select
            id="lc-track"
            value={workflowId}
            onChange={(e) => {
              setWorkflowId(e.target.value);
              setView(null);
              setMessage(null);
            }}
          >
            {tracks.map((t) => (
              <option key={t.workflowId} value={t.workflowId}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        <Btn disabled={pending || !workflowId} onClick={check}>
          {pending && !view ? "Checking…" : "Check logins. Nothing is sent yet"}
        </Btn>
      </Card>

      {message && <Alert tone={message.ok ? "success" : "danger"}>{message.text}</Alert>}

      {view && (
        <Card>
          <p className="mb-1">
            <strong>{view.total}</strong> people on this track: <strong>{view.signedIn}</strong>{" "}
            signed in, <strong>{view.waiting}</strong> have a valid login they haven&apos;t used
            yet, <strong>{view.problems.length}</strong> can&apos;t sign in.
          </p>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">
              Resending gives each person a new temporary password (72 hours), and their unstarted
              steps restart from that email.
            </p>
            <Btn disabled={pending || view.resendable === 0} onClick={() => setConfirm(true)}>
              Resend login to {view.resendable}
            </Btn>
          </div>
          {view.problems.length > 0 && (
            <div className="max-h-[32rem] overflow-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-neutral-bg text-left">
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Email</th>
                    <th className="px-3 py-2">Problem</th>
                    <th className="px-3 py-2">Last login email</th>
                  </tr>
                </thead>
                <tbody>
                  {view.problems.map((p, i) => (
                    <tr key={p.email + i} className="border-t border-border">
                      <td className="px-3 py-1.5">{p.name}</td>
                      <td className="px-3 py-1.5">{p.email}</td>
                      <td className="px-3 py-1.5">
                        <StatusPill tone={PROBLEM[p.problem]?.tone ?? "neutral"}>
                          {PROBLEM[p.problem]?.label ?? p.problem}
                        </StatusPill>
                      </td>
                      <td className="px-3 py-1.5">{p.lastEmail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <ConfirmDialog
        open={confirm}
        title={`Send new logins to ${view?.resendable ?? 0} people?`}
        body="Each gets a new temporary password by email; any old one stops working. Bounced addresses and queued emails are skipped."
        confirmLabel="Send logins"
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          start(async () => {
            const res = await resendLoginsAction({ workflowId }, view?.resendable ?? 0);
            if (res.ok) {
              setMessage({ ok: true, text: `Queued ${res.resent} new logins.` });
              setView(await loginCheckAction({ workflowId }));
            } else setMessage({ ok: false, text: res.error });
          });
        }}
      />
    </div>
  );
}
