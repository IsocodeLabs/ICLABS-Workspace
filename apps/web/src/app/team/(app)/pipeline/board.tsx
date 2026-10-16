"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckSquare, Clock, LayoutGrid, Play, Rows3, Square } from "lucide-react";
import { STAGE_TYPES, type NodeType } from "@iclabs/core/workflow";
import { Btn, Input, Select, TextArea } from "@/components/admin";
import { ConfirmDialog, Dialog } from "@/components/dialog";
import { Alert, StatusPill, type Tone } from "@/components/ui";
import {
  bulkDecideAction,
  decideAction,
  extendDeadlineAction,
  runRulesAction,
} from "../reviews/actions";

type Card = {
  applicationId: string;
  candidateId: string;
  candidateName: string;
  email: string;
  status: string;
  currentNodeId: string | null;
  progressId: string | null;
  stageState: string | null;
  composite: number | null;
  openReviews: number;
  dueAt: string | null;
  invitedAt: string;
};
type Node = { id: string; title: string; type: NodeType };
type BatchRow = { applicationId: string; candidateName: string; score: number | null; rank: number; target: string; wouldReject: boolean };

const STATE_LABEL: Record<string, [string, Tone]> = {
  unlocked: ["Not started", "neutral"],
  in_progress: ["In progress", "neutral"],
  submitted: ["Submitted", "warning"],
  reviewed: ["Reviewed", "success"],
  passed: ["Passed", "success"],
  failed: ["Not progressing", "danger"],
  missed: ["Missed deadline", "danger"],
};

const LANES: { id: string; title: string; match: (c: Card) => boolean; tone: string }[] = [
  { id: "needs_decision", title: "Needs a decision", match: (c) => c.status === "needs_decision", tone: "var(--warning-fg)" },
  { id: "on_hold", title: "On hold", match: (c) => c.status === "on_hold", tone: "var(--neutral-fg)" },
  { id: "completed", title: "Completed", match: (c) => c.status === "completed" || c.status === "interview_scheduled", tone: "var(--success-fg)" },
  { id: "closed", title: "Not progressing", match: (c) => c.status.startsWith("closed_"), tone: "var(--danger-fg)" },
];

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export function PipelineBoard({
  workflowId,
  nodes,
  cards,
  isAdmin,
}: {
  workflowId: string;
  nodes: Node[];
  cards: Card[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState<"board" | "table">("board");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Card | null>(null);
  const [rulesFor, setRulesFor] = useState<Node | null>(null);
  const [bulk, setBulk] = useState<null | "advance" | "hold" | "reject">(null);
  const [flash, setFlash] = useState<string | null>(null);

  const columns = useMemo(() => {
    const stageCols = nodes.map((n) => ({
      id: n.id,
      title: n.title,
      node: n,
      tone: STAGE_TYPES[n.type].color,
      cards: cards.filter((c) => c.status === "active" && c.currentNodeId === n.id),
    }));
    const lanes = LANES.map((l) => ({ id: l.id, title: l.title, node: null, tone: l.tone, cards: cards.filter(l.match) }));
    return [...lanes.slice(0, 1), ...stageCols, ...lanes.slice(1)];
  }, [nodes, cards]);

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const stageTitle = (id: string | null) => nodes.find((n) => n.id === id)?.title ?? "—";

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-xl border border-border bg-surface p-1" role="group" aria-label="View">
          {(["board", "table"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-sm font-semibold ${view === v ? "bg-brand-500 text-white" : "text-muted"}`}
            >
              {v === "board" ? <LayoutGrid size={15} aria-hidden /> : <Rows3 size={15} aria-hidden />} {v === "board" ? "Board" : "Table"}
            </button>
          ))}
        </div>
        <p className="text-sm text-muted">{cards.length} {cards.length === 1 ? "candidate" : "candidates"}</p>
        {selected.size > 0 && (
          <div className="ml-auto flex items-center gap-2 rounded-xl bg-brand-soft px-3 py-1.5">
            <span className="text-sm font-semibold">{selected.size} selected</span>
            <Btn size="sm" variant="secondary" onClick={() => setBulk("advance")}>Move to…</Btn>
            <Btn size="sm" variant="secondary" onClick={() => setBulk("hold")}>Hold</Btn>
            <Btn size="sm" variant="danger" onClick={() => setBulk("reject")}>Not progressing</Btn>
            <Btn size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Btn>
          </div>
        )}
      </div>
      {flash && <Alert tone="success">{flash}</Alert>}

      {view === "board" ? (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {columns.map((col) => (
            <section key={col.id} className="flex w-72 shrink-0 flex-col rounded-card border border-border bg-neutral-bg/60">
              <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: col.tone }} aria-hidden />
                <h2 className="flex-1 truncate text-sm font-bold">{col.title}</h2>
                <span className="rounded-full bg-surface px-2 text-xs font-semibold tabular-nums">{col.cards.length}</span>
                {isAdmin && col.node && (
                  <button
                    type="button"
                    title="Run this stage's rules now"
                    aria-label={`Run rules for ${col.title}`}
                    onClick={() => setRulesFor(col.node)}
                    className="rounded-md p-1 text-muted hover:bg-surface hover:text-brand-600"
                  >
                    <Play size={14} />
                  </button>
                )}
              </header>
              <div className="flex max-h-[65vh] flex-col gap-2 overflow-y-auto p-2">
                {col.cards.length === 0 && <p className="px-2 py-6 text-center text-xs text-muted">Nobody here</p>}
                {col.cards.map((c) => (
                  <PipelineCard
                    key={c.applicationId}
                    card={c}
                    stageTitle={col.node ? null : stageTitle(c.currentNodeId)}
                    selected={selected.has(c.applicationId)}
                    onToggle={() => toggle(c.applicationId)}
                    onOpen={() => setOpen(c)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-card border border-border bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-muted">
              <tr>
                <th className="w-10 px-3 py-2" />
                <th className="px-3 py-2">Candidate</th>
                <th className="px-3 py-2">Stage</th>
                <th className="px-3 py-2">State</th>
                <th className="px-3 py-2 text-right">Composite</th>
                <th className="px-3 py-2">Due</th>
              </tr>
            </thead>
            <tbody>
              {[...cards]
                .sort((a, b) => (b.composite ?? -1) - (a.composite ?? -1))
                .map((c) => (
                  <tr key={c.applicationId} className="border-b border-border last:border-0 hover:bg-neutral-bg">
                    <td className="px-3 py-2">
                      <input type="checkbox" aria-label={`Select ${c.candidateName}`} checked={selected.has(c.applicationId)} onChange={() => toggle(c.applicationId)} />
                    </td>
                    <td className="px-3 py-2">
                      <button type="button" className="font-semibold hover:underline" onClick={() => setOpen(c)}>
                        {c.candidateName}
                      </button>
                      <p className="text-xs text-muted">{c.email}</p>
                    </td>
                    <td className="px-3 py-2">{stageTitle(c.currentNodeId)}</td>
                    <td className="px-3 py-2">
                      <StateBadge card={c} />
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{c.composite ?? "—"}</td>
                    <td className="px-3 py-2 text-muted">{c.dueAt ? fmt(c.dueAt) : "—"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <DecisionDialog
          card={open}
          nodes={nodes}
          isAdmin={isAdmin}
          onClose={(msg) => {
            setOpen(null);
            if (msg) {
              setFlash(msg);
              router.refresh();
            }
          }}
        />
      )}
      {rulesFor && (
        <RulesDialog
          workflowId={workflowId}
          node={rulesFor}
          nodes={nodes}
          onClose={(msg) => {
            setRulesFor(null);
            if (msg) {
              setFlash(msg);
              router.refresh();
            }
          }}
        />
      )}
      {bulk && (
        <BulkDialog
          action={bulk}
          ids={[...selected]}
          nodes={nodes}
          onClose={(msg) => {
            setBulk(null);
            if (msg) {
              setSelected(new Set());
              setFlash(msg);
              router.refresh();
            }
          }}
        />
      )}
    </>
  );
}

function StateBadge({ card }: { card: Card }) {
  if (card.openReviews > 0) return <StatusPill tone="warning">In review</StatusPill>;
  const s = card.stageState ? STATE_LABEL[card.stageState] : null;
  return s ? <StatusPill tone={s[1]}>{s[0]}</StatusPill> : null;
}

function PipelineCard({
  card,
  stageTitle,
  selected,
  onToggle,
  onOpen,
}: {
  card: Card;
  stageTitle: string | null;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  return (
    <article
      className={`group rounded-xl border bg-surface p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-card ${selected ? "border-brand-500 ring-2 ring-brand-500/30" : "border-border"}`}
    >
      <div className="flex items-start gap-2">
        <button type="button" onClick={onToggle} aria-label={`${selected ? "Deselect" : "Select"} ${card.candidateName}`} className="mt-0.5 text-muted hover:text-brand-600">
          {selected ? <CheckSquare size={16} /> : <Square size={16} />}
        </button>
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <p className="truncate font-semibold">{card.candidateName}</p>
          {stageTitle && <p className="truncate text-xs text-muted">at {stageTitle}</p>}
        </button>
        {card.composite !== null && (
          <span className="rounded-lg bg-brand-soft px-1.5 py-0.5 text-xs font-bold tabular-nums text-brand-600">{card.composite}</span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-6">
        <StateBadge card={card} />
        {card.dueAt && card.status === "active" && (
          <span className="inline-flex items-center gap-1 text-xs text-muted">
            <Clock size={12} aria-hidden /> {fmt(card.dueAt)}
          </span>
        )}
      </div>
    </article>
  );
}

function DecisionDialog({
  card,
  nodes,
  isAdmin,
  onClose,
}: {
  card: Card;
  nodes: Node[];
  isAdmin: boolean;
  onClose: (msg?: string) => void;
}) {
  const [target, setTarget] = useState(nodes.find((n) => n.id !== card.currentNodeId)?.id ?? "");
  const [note, setNote] = useState("");
  const [until, setUntil] = useState("");
  const [confirmReject, setConfirmReject] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const closed = card.status.startsWith("closed_") || card.status === "completed";

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, msg: string) =>
    start(async () => {
      const res = await fn();
      if (res.ok) onClose(msg);
      else setError(res.error ?? "Something went wrong.");
    });

  return (
    <>
      <Dialog open onClose={() => onClose()} title={card.candidateName}>
        <p className="-mt-2 mb-4 text-sm text-muted">
          {card.email} · <Link className="underline" href={`/team/candidates/${card.candidateId}`}>Profile, submissions & emails</Link>
        </p>
        {error && <Alert>{error}</Alert>}
        {!closed && (
          <>
            <label className="mb-1 block text-sm font-semibold" htmlFor="target">Move to stage</label>
            <div className="flex gap-2">
              <Select id="target" value={target} onChange={(e) => setTarget(e.target.value)}>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.title}{n.id === card.currentNodeId ? " (current — reopen)" : ""}
                  </option>
                ))}
              </Select>
              <Btn
                disabled={!target || pending}
                onClick={() => run(() => decideAction(card.applicationId, { action: "advance", targetNodeId: target, note: note || undefined }), `${card.candidateName} moved on.`)}
              >
                Move
              </Btn>
            </div>
            <label className="mt-4 mb-1 block text-sm font-semibold" htmlFor="note">Note (kept in the audit trail)</label>
            <TextArea id="note" value={note} onChange={(e) => setNote(e.target.value)} className="min-h-16" />
            <div className="mt-4 flex flex-wrap gap-2">
              <Btn variant="secondary" disabled={pending} onClick={() => run(() => decideAction(card.applicationId, { action: "complete", note: note || undefined }), "Marked complete.")}>
                Mark complete
              </Btn>
              {card.status !== "on_hold" && (
                <Btn variant="secondary" disabled={pending} onClick={() => run(() => decideAction(card.applicationId, { action: "hold", note: note || undefined }), "On hold.")}>
                  Hold
                </Btn>
              )}
              <Btn variant="danger" disabled={pending} onClick={() => setConfirmReject(true)}>
                Not progressing
              </Btn>
            </div>
            {isAdmin && card.progressId && card.status !== "completed" && (
              <div className="mt-5 border-t border-border pt-4">
                <label className="mb-1 block text-sm font-semibold" htmlFor="until">Extend the current deadline to</label>
                <div className="flex gap-2">
                  <Input id="until" type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} />
                  <Btn
                    variant="secondary"
                    disabled={!until || pending}
                    onClick={() => run(() => extendDeadlineAction(card.progressId!, new Date(until).toISOString()), "Deadline extended.")}
                  >
                    Extend
                  </Btn>
                </div>
                <p className="mt-1 text-xs text-muted">Also reopens a missed stage. Times are in your local time zone.</p>
              </div>
            )}
          </>
        )}
        {(card.status === "closed_rejected" || card.status === "completed" || card.status === "on_hold") && (
          <Btn
            variant="secondary"
            className="mt-4"
            disabled={pending}
            onClick={() => run(() => decideAction(card.applicationId, { action: "reopen", note: note || undefined }), "Reopened.")}
          >
            Reopen
          </Btn>
        )}
        {card.status === "closed_rejected" && (
          <p className="mt-2 text-xs text-muted">Reopening within 48 hours cancels the not-progressing email before it goes out.</p>
        )}
      </Dialog>
      <ConfirmDialog
        open={confirmReject}
        title={`Not progressing ${card.candidateName}?`}
        body="Their application closes and they get the not-progressing email in 48 hours. You can reopen before then to cancel the email."
        confirmLabel="Not progressing"
        onCancel={() => setConfirmReject(false)}
        onConfirm={() => {
          setConfirmReject(false);
          run(() => decideAction(card.applicationId, { action: "reject", note: note || undefined }), `${card.candidateName} won't progress.`);
        }}
      />
    </>
  );
}

function RulesDialog({
  workflowId,
  node,
  nodes,
  onClose,
}: {
  workflowId: string;
  node: Node;
  nodes: Node[];
  onClose: (msg?: string) => void;
}) {
  const [rows, setRows] = useState<BatchRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const label = (t: string) =>
    t === "NEEDS_DECISION" ? "Stays for a decision" : t === "END_REJECT" ? "Not progressing" : t === "END_COMPLETE" ? "Complete" : `→ ${nodes.find((n) => n.id === t)?.title ?? t}`;

  const go = (dryRun: boolean) =>
    start(async () => {
      const res = await runRulesAction(workflowId, node.id, dryRun);
      if (!res.ok) return setError(res.error);
      if (dryRun) setRows(res.rows);
      else onClose(`Rules ran for ${res.rows.length} candidates at ${node.title}.`);
    });

  return (
    <Dialog
      open
      onClose={() => onClose()}
      title={`Run rules: ${node.title}`}
      footer={
        <>
          <Btn variant="secondary" onClick={() => onClose()}>Cancel</Btn>
          {rows ? (
            <Btn variant="gradient" disabled={pending || rows.length === 0} onClick={() => go(false)}>
              Apply to {rows.length}
            </Btn>
          ) : (
            <Btn disabled={pending} onClick={() => go(true)}>
              {pending ? "Working…" : "Preview"}
            </Btn>
          )}
        </>
      }
    >
      <p className="text-sm text-muted">
        Ranks everyone waiting for a decision at this stage and applies its rules (including “top N” rules). Preview first: nothing changes until you apply.
      </p>
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
      {rows && (
        <div className="mt-4 max-h-80 overflow-y-auto">
          {rows.length === 0 ? (
            <p className="text-sm text-muted">Nobody is waiting for a decision here.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {rows.map((r) => (
                  <tr key={r.applicationId} className="border-b border-border last:border-0">
                    <td className="py-1.5 pr-2 font-bold tabular-nums text-muted">#{r.rank}</td>
                    <td className="py-1.5 pr-2 font-semibold">{r.candidateName}</td>
                    <td className="py-1.5 pr-2 tabular-nums">{r.score ?? "—"}</td>
                    <td className={`py-1.5 ${r.wouldReject ? "text-danger-fg" : ""}`}>
                      {label(r.target)}
                      {r.wouldReject && " (rule says reject — you decide)"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </Dialog>
  );
}

function BulkDialog({
  action,
  ids,
  nodes,
  onClose,
}: {
  action: "advance" | "hold" | "reject";
  ids: string[];
  nodes: Node[];
  onClose: (msg?: string) => void;
}) {
  const [target, setTarget] = useState(nodes[0]?.id ?? "");
  const [pending, start] = useTransition();
  const title =
    action === "advance" ? `Move ${ids.length} candidates` : action === "hold" ? `Hold ${ids.length} candidates?` : `${ids.length} candidates not progressing?`;
  const go = () =>
    start(async () => {
      const res = await bulkDecideAction(
        ids,
        action === "advance" ? { action: "advance", targetNodeId: target } : { action },
      );
      onClose(`${res.done} updated${res.failed ? `, ${res.failed} skipped (closed or not allowed)` : ""}.`);
    });
  return (
    <Dialog
      open
      tone={action === "reject" ? "danger" : "default"}
      onClose={() => onClose()}
      title={title}
      footer={
        <>
          <Btn variant="secondary" onClick={() => onClose()}>Cancel</Btn>
          <Btn variant={action === "reject" ? "danger" : "primary"} disabled={pending} onClick={go}>
            {pending ? "Working…" : "Confirm"}
          </Btn>
        </>
      }
    >
      {action === "advance" ? (
        <Select aria-label="Stage" value={target} onChange={(e) => setTarget(e.target.value)}>
          {nodes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.title}
            </option>
          ))}
        </Select>
      ) : action === "reject" ? (
        <p className="text-sm text-muted">Each gets the not-progressing email in 48 hours unless you reopen them first.</p>
      ) : (
        <p className="text-sm text-muted">They stay where they are until you reopen or move them.</p>
      )}
    </Dialog>
  );
}
