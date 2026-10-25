"use client";

import { useState, useTransition } from "react";
import { Btn, Card, Field, Input, Select } from "@/components/admin";
import { ConfirmDialog } from "@/components/dialog";
import { Alert, StatusPill } from "@/components/ui";
import { previewStepDeadlineAction, setStepDeadlineAction, type DeadlinePreview } from "./actions";

type Track = { workflowId: string; label: string; nodes: { id: string; title: string }[] };

export function DeadlinePanel({ tracks }: { tracks: Track[] }) {
  const [workflowId, setWorkflowId] = useState(tracks[0]?.workflowId ?? "");
  const [nodeId, setNodeId] = useState(tracks[0]?.nodes[0]?.id ?? "");
  const [dueAt, setDueAt] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [preview, setPreview] = useState<DeadlinePreview | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const track = tracks.find((t) => t.workflowId === workflowId);
  const datesOk = Boolean(dueAt && closesAt && closesAt >= dueAt);

  const changed = () => {
    setPreview(null);
    setMessage(null);
  };

  return (
    <div className="space-y-6">
      <Card>
        <div className="grid gap-x-4 md:grid-cols-2">
          <Field label="Track" htmlFor="d-track">
            <Select
              id="d-track"
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
          <Field label="Step" htmlFor="d-node">
            <Select
              id="d-node"
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
          <Field
            label="On time until (IST)"
            htmlFor="d-due"
            hint="Submissions after this are still accepted, but marked late."
          >
            <Input
              id="d-due"
              type="datetime-local"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
            />
          </Field>
          <Field
            label="Closes for good (IST)"
            htmlFor="d-close"
            hint="After this nobody can submit. Same as above for no late window."
          >
            <Input
              id="d-close"
              type="datetime-local"
              value={closesAt}
              onChange={(e) => setClosesAt(e.target.value)}
            />
          </Field>
        </div>
        {dueAt && closesAt && !datesOk && (
          <p className="mb-3 text-sm text-danger-fg">
            The final close can&apos;t be before the on-time deadline.
          </p>
        )}
        <Btn
          disabled={pending || !workflowId || !nodeId}
          onClick={() =>
            start(async () => {
              setMessage(null);
              setPreview(await previewStepDeadlineAction({ workflowId, nodeId }));
            })
          }
        >
          {pending && !preview ? "Loading…" : "Show who's at this step. Nothing changes yet"}
        </Btn>
      </Card>

      {message && <Alert tone={message.ok ? "success" : "danger"}>{message.text}</Alert>}

      {preview && (
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-lg font-semibold">
              {preview.rows.length} {preview.rows.length === 1 ? "person" : "people"} at this step
              {preview.rows.length > 0 && (
                <span className="ml-2 text-sm font-normal text-muted">
                  (
                  {preview.distinctDates === 1
                    ? "all on the same dates"
                    : `${preview.distinctDates} different sets of dates`}
                  )
                </span>
              )}
            </h2>
            <Btn
              disabled={pending || preview.rows.length === 0 || !datesOk}
              onClick={() => setConfirm(true)}
            >
              Set these dates for all {preview.rows.length}
            </Btn>
          </div>
          <div className="max-h-[28rem] overflow-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-neutral-bg text-left">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">State</th>
                  <th className="px-3 py-2">Due now</th>
                  <th className="px-3 py-2">Closes now</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r, i) => (
                  <tr key={r.email + i} className="border-t border-border">
                    <td className="px-3 py-1.5">{r.name}</td>
                    <td className="px-3 py-1.5">{r.email}</td>
                    <td className="px-3 py-1.5">{r.state.replace("_", " ")}</td>
                    <td className="px-3 py-1.5">{r.due}</td>
                    <td className="px-3 py-1.5">
                      {r.closes}{" "}
                      {r.extended && <StatusPill tone="warning">Extension, cleared</StatusPill>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={confirm}
        title={`Set the same dates for ${preview?.rows.length ?? 0} people?`}
        body="Everyone at this step gets these dates. Personal extensions are removed, and anyone marked missed is reopened if the final close is still ahead. Candidates see the new dates straight away."
        confirmLabel="Set dates"
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          start(async () => {
            const res = await setStepDeadlineAction(
              { workflowId, nodeId, dueAt, closesAt },
              preview?.rows.length ?? 0,
            );
            if (res.ok) {
              setMessage({
                ok: true,
                text: `Updated ${res.updated} people.${res.reopened ? ` Reopened ${res.reopened} who had missed it.` : ""}`,
              });
              setPreview(await previewStepDeadlineAction({ workflowId, nodeId }));
            } else setMessage({ ok: false, text: res.error });
          });
        }}
      />
    </div>
  );
}
