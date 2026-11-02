"use client";

import { useState, useTransition } from "react";
import { Btn, Card, Field, Select } from "@/components/admin";
import { ConfirmDialog } from "@/components/dialog";
import { Alert } from "@/components/ui";
import { previewReleaseAction, releaseTaskAction, type ReleasePreview } from "./actions";

type Track = { workflowId: string; label: string };

export function ReleasePanel({ tracks }: { tracks: Track[] }) {
  const [workflowId, setWorkflowId] = useState(tracks[0]?.workflowId ?? "");
  const [preview, setPreview] = useState<ReleasePreview | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const count = preview?.people.length ?? 0;

  return (
    <div className="space-y-6">
      <Card>
        <Field label="Track" htmlFor="r-track">
          <Select
            id="r-track"
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
              setPreview(await previewReleaseAction({ workflowId }));
            })
          }
        >
          {pending && !preview ? "Loading…" : "Preview. Nothing changes yet"}
        </Btn>
      </Card>

      {message && <Alert tone={message.ok ? "success" : "danger"}>{message.text}</Alert>}

      {preview && (
        <>
          <Card>
            <h2 className="mb-1 font-display text-lg font-semibold">The email</h2>
            <p className="mb-3 text-sm text-muted">
              Shown as the first person on the list would read it. The deadline is set when you
              release: seven days later, 11:59 pm IST.
            </p>
            <p className="mb-2 font-semibold">Subject: {preview.subject}</p>
            <pre className="whitespace-pre-wrap rounded-xl border border-border bg-neutral-bg p-4 font-sans text-sm leading-relaxed">
              {preview.text}
            </pre>
          </Card>

          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-lg font-semibold">
                {count} {count === 1 ? "person" : "people"} will get the task
              </h2>
              <Btn disabled={pending || count === 0} onClick={() => setConfirm(true)}>
                Release to {count}
              </Btn>
            </div>
            <div className="max-h-[28rem] overflow-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-neutral-bg text-left">
                  <tr>
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Email</th>
                    <th className="px-3 py-2">Role</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.people.map((p, i) => (
                    <tr key={p.email + i} className="border-t border-border">
                      <td className="px-3 py-1.5 text-muted">{i + 1}</td>
                      <td className="px-3 py-1.5">{p.name}</td>
                      <td className="px-3 py-1.5">{p.email}</td>
                      <td className="px-3 py-1.5">{p.roleTitle}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      <ConfirmDialog
        open={confirm}
        title={`Release the task to ${count} people?`}
        body="The task opens in their workspace now with a one-week deadline, and each gets an email within a few minutes. This cannot be recalled."
        confirmLabel="Release"
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          start(async () => {
            const res = await releaseTaskAction({ workflowId }, count);
            if (res.ok) {
              setMessage({ ok: true, text: `Released to ${res.released} people. Emails are queued.` });
              setPreview(null);
            } else setMessage({ ok: false, text: res.error });
          });
        }}
      />
    </div>
  );
}
