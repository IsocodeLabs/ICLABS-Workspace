"use client";

import { useState, useTransition } from "react";
import { Btn, Card, Field, Select } from "@/components/admin";
import { ConfirmDialog } from "@/components/dialog";
import { Alert, StatusPill } from "@/components/ui";
import { loginRestartAction, type LoginRestartPreview } from "./actions";

type Track = { workflowId: string; label: string; nodes: { id: string; title: string }[] };

/** Gives people mailed after their invite the full time on steps they haven't started. */
export function LoginRestartPanel({ tracks }: { tracks: Track[] }) {
  const [workflowId, setWorkflowId] = useState(tracks[0]?.workflowId ?? "");
  const [preview, setPreview] = useState<LoginRestartPreview | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const track = tracks.find((t) => t.workflowId === workflowId);
  const stepTitle = (id: string) => track?.nodes.find((n) => n.id === id)?.title ?? id;

  return (
    <Card>
      <h2 className="mb-1 font-display text-lg font-semibold">
        Start deadlines from each person&apos;s login email
      </h2>
      <p className="mb-4 text-sm text-muted">
        A step&apos;s deadline counts from when it opened. If someone&apos;s login email reached
        them later (a scheduled invite or a resent login), steps they haven&apos;t started are
        re-timed from that email. Deadlines only ever move later; personal extensions are left
        alone. New login emails do this automatically.
      </p>
      <Field label="Track" htmlFor="l-track">
        <Select
          id="l-track"
          value={workflowId}
          onChange={(e) => {
            setWorkflowId(e.target.value);
            setPreview(null);
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
      <Btn
        disabled={pending || !workflowId}
        onClick={() =>
          start(async () => {
            setMessage(null);
            const res = await loginRestartAction({ workflowId }, false);
            if ("error" in res) setMessage({ ok: false, text: res.error });
            else setPreview(res);
          })
        }
      >
        {pending && !preview ? "Checking…" : "Show who gets more time. Nothing changes yet"}
      </Btn>

      {message && (
        <div className="mt-4">
          <Alert tone={message.ok ? "success" : "danger"}>{message.text}</Alert>
        </div>
      )}

      {preview && (
        <div className="mt-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <p className="font-semibold">
              {preview.rows.length === 0
                ? "Everyone's deadlines already start from their login email."
                : `${preview.rows.length} ${preview.rows.length === 1 ? "step" : "steps"} would get more time`}
            </p>
            {preview.rows.length > 0 && (
              <Btn disabled={pending} onClick={() => setConfirm(true)}>
                Apply to {preview.rows.length}
              </Btn>
            )}
          </div>
          {preview.rows.length > 0 && (
            <div className="max-h-[28rem] overflow-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-neutral-bg text-left">
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Step</th>
                    <th className="px-3 py-2">Login email sent</th>
                    <th className="px-3 py-2">Due now</th>
                    <th className="px-3 py-2">New due</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r, i) => (
                    <tr key={r.email + r.nodeId + i} className="border-t border-border">
                      <td className="px-3 py-1.5">
                        {r.name}
                        <div className="text-xs text-muted">{r.email}</div>
                      </td>
                      <td className="px-3 py-1.5">{stepTitle(r.nodeId)}</td>
                      <td className="px-3 py-1.5">{r.loginEmail}</td>
                      <td className="px-3 py-1.5">{r.from}</td>
                      <td className="px-3 py-1.5">
                        {r.to} {r.reopened && <StatusPill tone="warning">Reopens</StatusPill>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirm}
        title={`Give ${preview?.rows.length ?? 0} steps more time?`}
        body="Each deadline moves to count from that person's login email. Steps marked missed reopen if the new deadline is still ahead. Each person is emailed their new date."
        confirmLabel="Apply"
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          start(async () => {
            const res = await loginRestartAction({ workflowId }, true);
            if ("error" in res) setMessage({ ok: false, text: res.error });
            else {
              setMessage({ ok: true, text: `Updated ${res.rows.length} steps.` });
              setPreview(null);
            }
          });
        }}
      />
    </Card>
  );
}
