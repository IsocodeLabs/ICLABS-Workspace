"use client";

import { useState, useTransition } from "react";
import { Btn, Card, Field, Select } from "@/components/admin";
import { ConfirmDialog } from "@/components/dialog";
import { Alert, StatusPill } from "@/components/ui";
import {
  previewAnnouncementAction,
  sendAnnouncementAction,
  type AnnouncementPreview,
} from "./actions";

type Track = { workflowId: string; label: string; nodes: { id: string; title: string }[] };
type Kind = { key: string; label: string; audience: string };

export function MessagePanel({ tracks, kinds }: { tracks: Track[]; kinds: Kind[] }) {
  const [workflowId, setWorkflowId] = useState(tracks[0]?.workflowId ?? "");
  const [nodeId, setNodeId] = useState(tracks[0]?.nodes[0]?.id ?? "");
  const [key, setKey] = useState(kinds[0]?.key ?? "");
  const [preview, setPreview] = useState<AnnouncementPreview | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const track = tracks.find((t) => t.workflowId === workflowId);
  const kind = kinds.find((k) => k.key === key);
  const payload = { workflowId, nodeId, key };

  const changed = () => {
    setPreview(null);
    setMessage(null);
  };

  return (
    <div className="space-y-6">
      <Card>
        <div className="grid gap-x-4 md:grid-cols-3">
          <Field label="Track" htmlFor="m-track">
            <Select
              id="m-track"
              value={workflowId}
              onChange={(e) => {
                setWorkflowId(e.target.value);
                setNodeId(tracks.find((t) => t.workflowId === e.target.value)?.nodes[0]?.id ?? "");
                changed();
              }}
            >
              {tracks.map((t) => (
                <option key={t.workflowId} value={t.workflowId}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Step" htmlFor="m-node">
            <Select
              id="m-node"
              value={nodeId}
              onChange={(e) => {
                setNodeId(e.target.value);
                changed();
              }}
            >
              {track?.nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Email" htmlFor="m-key" hint={kind?.audience}>
            <Select
              id="m-key"
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                changed();
              }}
            >
              {kinds.map((k) => (
                <option key={k.key} value={k.key}>
                  {k.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Btn
          disabled={pending || !workflowId || !nodeId}
          onClick={() =>
            start(async () => {
              setMessage(null);
              setPreview(await previewAnnouncementAction(payload));
            })
          }
        >
          {pending && !preview ? "Loading…" : "Preview. Nothing is sent yet"}
        </Btn>
      </Card>

      {message && <Alert tone={message.ok ? "success" : "danger"}>{message.text}</Alert>}

      {preview && (
        <>
          <Card>
            <h2 className="mb-1 font-display text-lg font-semibold">The email</h2>
            <p className="mb-3 text-sm text-muted">
              Shown as the first person on the list would read it. The name, role and step change
              for each person.
            </p>
            <p className="mb-2 font-semibold">Subject: {preview.subject}</p>
            <pre className="whitespace-pre-wrap rounded-xl border border-border bg-neutral-bg p-4 font-sans text-sm leading-relaxed">
              {preview.text}
            </pre>
          </Card>

          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-lg font-semibold">
                {preview.toSend} {preview.toSend === 1 ? "person" : "people"} will get this
                {preview.skipped > 0 && (
                  <span className="ml-2 text-sm font-normal text-muted">
                    ({preview.skipped} already got it and are skipped)
                  </span>
                )}
              </h2>
              <Btn disabled={pending || preview.toSend === 0} onClick={() => setConfirm(true)}>
                Send {preview.toSend} {preview.toSend === 1 ? "email" : "emails"}
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
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {preview.recipients.map((r, i) => (
                    <tr key={r.email + i} className="border-t border-border">
                      <td className="px-3 py-1.5 text-muted">{i + 1}</td>
                      <td className="px-3 py-1.5">{r.name}</td>
                      <td className="px-3 py-1.5">{r.email}</td>
                      <td className="px-3 py-1.5">{r.roleTitle}</td>
                      <td className="px-3 py-1.5">
                        {r.alreadySent && <StatusPill tone="neutral">Already sent</StatusPill>}
                      </td>
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
        title={`Send ${preview?.toSend ?? 0} emails?`}
        body="They go out from the hiring address within a few minutes and can't be recalled."
        confirmLabel="Send"
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          start(async () => {
            const res = await sendAnnouncementAction(payload, preview?.toSend ?? 0);
            if (res.ok) {
              setMessage({ ok: true, text: `Queued ${res.sent} emails. ${res.skipped} skipped.` });
              setPreview(null);
            } else setMessage({ ok: false, text: res.error });
          });
        }}
      />
    </div>
  );
}
