"use client";

import { useState, useTransition } from "react";
import { Btn, Card, Field, Input } from "@/components/admin";
import { ConfirmDialog } from "@/components/dialog";
import { Alert, StatusPill } from "@/components/ui";
import type { ExtensionTrack } from "@/server/candidates/final-extension";
import {
  applyFinalExtensionAction,
  previewFinalExtensionAction,
  type ExtensionPreview,
} from "./actions";

const ACTION = {
  extend: { label: "Extend", tone: "success" },
  reopen: { label: "Reopens", tone: "warning" },
  keep: { label: "Already later, unchanged", tone: "neutral" },
} as const;

/** Pick a date and the steps per track; preview everyone affected; then apply. */
export function FinalExtensionPanel({ tracks }: { tracks: ExtensionTrack[] }) {
  const [until, setUntil] = useState("2026-10-31T23:59");
  // Steps reached without a team decision are ticked to start with.
  const [chosen, setChosen] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(
      tracks.map((t) => [t.workflowId, t.nodes.filter((n) => n.auto).map((n) => n.id)]),
    ),
  );
  const [preview, setPreview] = useState<ExtensionPreview | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const request = () => ({
    until,
    steps: tracks.map((t) => ({ workflowId: t.workflowId, nodeIds: chosen[t.workflowId] ?? [] })),
  });
  const toggle = (workflowId: string, nodeId: string) => {
    setPreview(null);
    setChosen((c) => {
      const cur = c[workflowId] ?? [];
      return {
        ...c,
        [workflowId]: cur.includes(nodeId) ? cur.filter((x) => x !== nodeId) : [...cur, nodeId],
      };
    });
  };
  const byRole = preview
    ? Object.entries(
        preview.rows.reduce<Record<string, Record<string, number>>>((m, r) => {
          m[r.role] ??= {};
          m[r.role]![r.action] = (m[r.role]![r.action] ?? 0) + 1;
          return m;
        }, {}),
      )
    : [];

  return (
    <Card>
      <Field label="Close everything chosen at (India time)" htmlFor="fe-until">
        <Input
          id="fe-until"
          type="datetime-local"
          value={until}
          onChange={(e) => {
            setUntil(e.target.value);
            setPreview(null);
          }}
        />
      </Field>
      <div className="mb-5 grid gap-4 md:grid-cols-3">
        {tracks.map((t) => (
          <fieldset key={t.workflowId} className="rounded-xl border border-border p-3">
            <legend className="px-1 text-sm font-semibold">{t.label}</legend>
            {t.nodes.map((n) => (
              <label key={n.id} className="flex items-start gap-2 py-1 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={(chosen[t.workflowId] ?? []).includes(n.id)}
                  onChange={() => toggle(t.workflowId, n.id)}
                />
                <span>
                  {n.title} <span className="text-muted">({n.type})</span>
                  {!n.auto && (
                    <span className="block text-xs text-muted">Opens after a team decision</span>
                  )}
                  {n.closesBy && (
                    <span className="block text-xs text-muted">
                      Final close set:{" "}
                      {new Date(n.closesBy).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </fieldset>
        ))}
      </div>
      <Btn
        disabled={pending}
        onClick={() =>
          start(async () => {
            setMessage(null);
            const res = await previewFinalExtensionAction(request());
            if ("error" in res) setMessage({ ok: false, text: res.error });
            else setPreview(res);
          })
        }
      >
        {pending && !preview ? "Checking…" : "Show everyone affected. Nothing changes yet"}
      </Btn>

      {message && (
        <div className="mt-4">
          <Alert tone={message.ok ? "success" : "danger"}>{message.text}</Alert>
        </div>
      )}

      {preview && (
        <div className="mt-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-semibold">
              {preview.changes} open {preview.changes === 1 ? "step" : "steps"} move to{" "}
              {preview.until}
            </p>
            {preview.changes > 0 && (
              <Btn disabled={pending} onClick={() => setConfirm(true)}>
                Apply to {preview.changes}
              </Btn>
            )}
          </div>
          <ul className="text-sm">
            {byRole.map(([role, counts]) => (
              <li key={role}>
                <span className="font-semibold">{role}:</span>{" "}
                {(["extend", "reopen", "keep"] as const)
                  .filter((a) => counts[a])
                  .map((a) => `${counts[a]} ${ACTION[a].label.toLowerCase()}`)
                  .join(", ")}
              </li>
            ))}
          </ul>
          {preview.notYetOpen.length > 0 && (
            <Alert tone="neutral">
              Not reached yet; these steps will close on {preview.until} when they open:{" "}
              {preview.notYetOpen.map((n) => `${n.role} · ${n.step}: ${n.people}`).join("; ")}
            </Alert>
          )}
          {preview.rows.length > 0 && (
            <div className="max-h-[32rem] overflow-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-neutral-bg text-left">
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Role</th>
                    <th className="px-3 py-2">Step</th>
                    <th className="px-3 py-2">Closes now</th>
                    <th className="px-3 py-2">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r, i) => (
                    <tr key={r.email + r.step + i} className="border-t border-border">
                      <td className="px-3 py-1.5">
                        {r.name}
                        <div className="text-xs text-muted">{r.email}</div>
                      </td>
                      <td className="px-3 py-1.5">{r.role}</td>
                      <td className="px-3 py-1.5">{r.step}</td>
                      <td className="px-3 py-1.5">{r.closesNow}</td>
                      <td className="px-3 py-1.5">
                        <StatusPill tone={ACTION[r.action].tone}>
                          {ACTION[r.action].label}
                        </StatusPill>
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
        title={`Move ${preview?.changes ?? 0} steps to ${preview?.until ?? ""}?`}
        body="Each open step gets the new closing time; missed ones reopen; nobody's date moves earlier. The chosen steps also close on this date for anyone who reaches them later. No email is sent."
        confirmLabel="Apply"
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          start(async () => {
            const res = await applyFinalExtensionAction(request(), preview?.changes ?? -1);
            if (!res.ok) setMessage({ ok: false, text: res.error });
            else {
              setMessage({
                ok: true,
                text: `Updated ${res.extended} steps (${res.reopened} reopened).`,
              });
              setPreview(null);
            }
          });
        }}
      />
    </Card>
  );
}
