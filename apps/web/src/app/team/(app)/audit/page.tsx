import Link from "next/link";
import { formatIst } from "@iclabs/core";
import { Btn, EmptyState, Page, PageHeader } from "@/components/admin";
import { StatusPill, type Tone } from "@/components/ui";
import { db } from "@/server/db";
import { requireTeam } from "@/server/auth/session";
import { listAudit, type AuditFilter } from "@/server/audit-log";

const viaTone: Record<string, Tone> = {
  ui: "neutral",
  mcp: "warning",
  rule: "success",
  system: "neutral",
};
const VIAS = ["ui", "mcp", "rule", "system"] as const;
const ENTITIES = [
  "application",
  "stage_progress",
  "workflow",
  "interview",
  "question",
  "candidate",
  "team_member",
  "review_assignment",
  "email_template",
];

function Change({ value }: { value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <pre className="mt-1 max-h-40 overflow-auto rounded-lg bg-neutral-bg px-3 py-2 text-xs">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { actor } = await requireTeam(["admin"]);
  const sp = await searchParams;
  const filter: AuditFilter = {
    action: sp.action || undefined,
    entity: sp.entity || undefined,
    via: VIAS.find((v) => v === sp.via),
    before: sp.before || undefined,
  };
  const { rows, next } = await listAudit(db(), actor, filter);
  const qs = (extra: Record<string, string>) =>
    `/team/audit?${new URLSearchParams(Object.entries({ ...filter, ...extra }).filter(([, v]) => v) as [string, string][])}`;

  return (
    <Page>
      <PageHeader
        title="Audit log"
        subtitle="Every admin action, decision, rule run and Claude (MCP) call. Append-only."
      />
      <form className="mb-6 flex flex-wrap items-end gap-3">
        <label className="text-sm font-semibold">
          Action
          <input
            name="action"
            defaultValue={filter.action}
            placeholder="e.g. reject"
            className="mt-1 block rounded-xl border border-border bg-surface px-3 py-2 font-normal"
          />
        </label>
        <label className="text-sm font-semibold">
          Entity
          <select
            name="entity"
            defaultValue={filter.entity ?? ""}
            className="mt-1 block rounded-xl border border-border bg-surface px-3 py-2 font-normal"
          >
            <option value="">Any</option>
            {ENTITIES.map((e) => (
              <option key={e} value={e}>
                {e.replace("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold">
          Via
          <select
            name="via"
            defaultValue={filter.via ?? ""}
            className="mt-1 block rounded-xl border border-border bg-surface px-3 py-2 font-normal"
          >
            <option value="">Any</option>
            {VIAS.map((v) => (
              <option key={v} value={v}>
                {v === "mcp" ? "Claude (MCP)" : v}
              </option>
            ))}
          </select>
        </label>
        <Btn type="submit">Filter</Btn>
        {(filter.action || filter.entity || filter.via) && (
          <Link
            href="/team/audit"
            className="py-2 text-sm font-semibold text-muted hover:text-text"
          >
            Clear
          </Link>
        )}
      </form>

      {rows.length === 0 ? (
        <EmptyState title="Nothing logged yet" body="Actions appear here as the team works." />
      ) : (
        <ol className="divide-y divide-border rounded-card border border-border bg-surface">
          {rows.map(({ e, email }) => (
            <li key={e.id} className="px-5 py-3">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center gap-3">
                  <span className="w-44 shrink-0 text-sm tabular-nums text-muted">
                    {formatIst(e.at)}
                  </span>
                  <span className="font-semibold">{e.action.replaceAll("_", " ")}</span>
                  <span className="text-sm text-muted">
                    {e.entity.replace("_", " ")}
                    {e.entityId ? ` · ${e.entityId.slice(-8)}` : ""}
                  </span>
                  <span className="ml-auto flex items-center gap-2 text-sm">
                    {email ?? "system"}
                    <StatusPill tone={viaTone[e.actorVia] ?? "neutral"}>
                      {e.actorVia === "mcp" ? "via Claude" : e.actorVia}
                    </StatusPill>
                  </span>
                </summary>
                <div className="mt-2 grid gap-3 md:grid-cols-2">
                  {e.before !== null && (
                    <div>
                      <p className="text-xs font-semibold text-muted">Before</p>
                      <Change value={e.before} />
                    </div>
                  )}
                  {e.after !== null && (
                    <div>
                      <p className="text-xs font-semibold text-muted">After</p>
                      <Change value={e.after} />
                    </div>
                  )}
                  {e.before === null && e.after === null && (
                    <p className="text-sm text-muted">No details recorded.</p>
                  )}
                </div>
              </details>
            </li>
          ))}
        </ol>
      )}
      {next && (
        <div className="mt-4 text-center">
          <Link
            href={qs({ before: next })}
            className="font-semibold text-brand-600 hover:underline"
          >
            Older entries →
          </Link>
        </div>
      )}
    </Page>
  );
}
