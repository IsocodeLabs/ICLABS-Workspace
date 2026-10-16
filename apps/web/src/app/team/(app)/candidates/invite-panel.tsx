"use client";

import { useActionState, useState, useTransition } from "react";
import { Upload } from "lucide-react";
import { Btn, Card, Field, Input, Select } from "@/components/admin";
import { Alert, StatusPill } from "@/components/ui";
import { inviteCsvAction, previewCsvAction, singleInviteAction, type PreviewLine } from "./actions";

const KIND = {
  new: { label: "New", tone: "success" },
  add_role: { label: "Add role", tone: "success" },
  duplicate: { label: "Skip", tone: "warning" },
  invalid: { label: "Error", tone: "danger" },
} as const;

export function InvitePanel({ roles }: { roles: { slug: string; title: string }[] }) {
  const [tab, setTab] = useState<"single" | "csv">("single");
  return (
    <Card>
      <div role="tablist" className="mb-5 flex gap-1">
        {(["single", "csv"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === t ? "bg-brand-soft text-brand-soft-fg" : "text-muted hover:bg-neutral-bg"}`}
          >
            {t === "single" ? "Invite one person" : "Upload CSV"}
          </button>
        ))}
      </div>
      {tab === "single" ? <SingleInvite roles={roles} /> : <CsvInvite />}
    </Card>
  );
}

function SingleInvite({ roles }: { roles: { slug: string; title: string }[] }) {
  const [state, action, pending] = useActionState(singleInviteAction, undefined);
  return (
    <form action={action}>
      {state && !state.ok && <Alert>{"error" in state ? state.error : ""}</Alert>}
      {state?.ok && "message" in state && <Alert tone="success">{state.message}</Alert>}
      <div className="grid gap-x-4 md:grid-cols-[1fr_1fr_1fr_auto]">
        <Field label="Name" htmlFor="inv-name">
          <Input id="inv-name" name="name" required />
        </Field>
        <Field label="Email (their login ID)" htmlFor="inv-email">
          <Input id="inv-email" name="email" type="email" required />
        </Field>
        <Field label="Role" htmlFor="inv-role">
          <Select id="inv-role" name="role" required>
            {roles.map((r) => (
              <option key={r.slug} value={r.slug}>
                {r.title}
              </option>
            ))}
          </Select>
        </Field>
        <div className="pt-6">
          <Btn type="submit" disabled={pending || roles.length === 0}>
            Invite
          </Btn>
        </div>
      </div>
      <p className="text-sm text-muted">
        They get a welcome email with a temporary password that works for 72 hours.
      </p>
    </form>
  );
}

function CsvInvite() {
  const [csv, setCsv] = useState("");
  const [lines, setLines] = useState<PreviewLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [sendAt, setSendAt] = useState("");
  const [pending, start] = useTransition();
  const ready = lines?.filter((l) => l.kind === "new" || l.kind === "add_role").length ?? 0;

  return (
    <div>
      <p className="mb-3 text-sm text-muted">
        Columns: <code>name, email, role</code> (the role&apos;s short name), plus optional{" "}
        <code>track, phone, college, grad_year, linkedin, github</code>.
      </p>
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-border px-4 py-3 font-semibold hover:border-brand-500">
        <Upload size={18} aria-hidden /> Choose CSV file
        <input
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            if (file.size > 2_000_000) return setError("CSV files up to 2 MB.");
            const text = await file.text();
            setCsv(text);
            setDone(null);
            start(async () => {
              const res = await previewCsvAction(text);
              setError(res.error ?? null);
              setLines(res.lines);
            });
          }}
        />
      </label>
      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}
      {done && (
        <div className="mt-3">
          <Alert tone="success">{done}</Alert>
        </div>
      )}
      {lines && lines.length > 0 && (
        <>
          <div className="mt-4 max-h-80 overflow-auto rounded-xl border border-border">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-surface text-muted">
                <tr>
                  <th className="px-3 py-2">Row</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lines.map((l) => (
                  <tr key={l.line}>
                    <td className="px-3 py-2 text-muted">{l.line}</td>
                    <td className="px-3 py-2">{l.name}</td>
                    <td className="px-3 py-2">{l.email}</td>
                    <td className="px-3 py-2">{l.role}</td>
                    <td className="px-3 py-2">
                      <StatusPill tone={KIND[l.kind].tone}>{KIND[l.kind].label}</StatusPill>
                      {l.reason && <span className="ml-2 text-muted">{l.reason}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <Field
              label="Send emails at (optional)"
              htmlFor="send-at"
              hint="Leave empty to send now."
            >
              <Input
                id="send-at"
                type="datetime-local"
                value={sendAt}
                onChange={(e) => setSendAt(e.target.value)}
              />
            </Field>
            <Btn
              className="mb-4"
              disabled={pending || ready === 0}
              onClick={() =>
                start(async () => {
                  const res = await inviteCsvAction(
                    csv,
                    sendAt ? new Date(sendAt).toISOString() : undefined,
                  );
                  if (!res.ok) return setError(res.error);
                  setLines(null);
                  setDone(
                    `Done: ${res.created} new accounts, ${res.rolesAdded} roles added to existing candidates, ${res.skipped} skipped.`,
                  );
                })
              }
            >
              Invite {ready} {ready === 1 ? "person" : "people"}
            </Btn>
          </div>
        </>
      )}
    </div>
  );
}
