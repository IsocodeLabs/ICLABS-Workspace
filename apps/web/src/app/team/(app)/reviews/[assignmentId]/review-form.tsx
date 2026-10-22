"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Keyboard, Sparkles } from "lucide-react";
import type { Rubric } from "@iclabs/core/workflow";
import { Btn, Card, TextArea } from "@/components/admin";
import { Alert } from "@/components/ui";
import { requestAiAction, submitReviewAction } from "../actions";

type Rec = "strong_yes" | "yes" | "no" | "strong_no";

const RECS: { id: Rec; label: string; tone: string }[] = [
  { id: "strong_yes", label: "Strong yes", tone: "bg-success-bg text-success-fg" },
  { id: "yes", label: "Yes", tone: "bg-success-bg text-success-fg" },
  { id: "no", label: "No", tone: "bg-danger-bg text-danger-fg" },
  { id: "strong_no", label: "Strong no", tone: "bg-danger-bg text-danger-fg" },
];

const max = (r: Rubric) => (r.scale === "1-10" ? 10 : r.scale === "1-5" ? 5 : 1);
const min = (r: Rubric) => (r.scale === "pass-fail" ? 0 : 1);

/** Same maths as the server's rubricPct, for the live total. */
function livePct(r: Rubric, scores: Record<string, number>) {
  const allZero = r.criteria.every((c) => c.weight === 0);
  const total = allZero ? r.criteria.length : r.criteria.reduce((n, c) => n + c.weight, 0);
  const sum = r.criteria.reduce(
    (n, c) => n + ((scores[c.id] ?? 0) / max(r)) * (allZero ? 1 : c.weight),
    0,
  );
  return Math.round((sum / total) * 1000) / 10;
}

export function ReviewForm({
  assignmentId,
  rubric,
  canSubmit,
  mine,
  ai,
  aiEnabled,
}: {
  assignmentId: string;
  rubric: Rubric | null;
  canSubmit: boolean;
  mine: {
    scores: Record<string, number>;
    recommendation: Rec | null;
    notes: string | null;
    totalPct: number | null;
  } | null;
  ai: {
    scores: Record<string, number>;
    evidence: Record<string, string>;
    notes: string | null;
    totalPct: number | null;
  } | null;
  aiEnabled: boolean;
}) {
  const router = useRouter();
  const [scores, setScores] = useState<Record<string, number>>(mine?.scores ?? {});
  const [rec, setRec] = useState<Rec | null>(mine?.recommendation ?? null);
  const [notes, setNotes] = useState(mine?.notes ?? "");
  const [fromAi, setFromAi] = useState(false);
  const [focus, setFocus] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [aiPending, startAi] = useTransition();
  const readOnly = !canSubmit;

  const complete = !!rec && (!rubric || rubric.criteria.every((c) => scores[c.id] !== undefined));
  const pct = useMemo(() => (rubric ? livePct(rubric, scores) : null), [rubric, scores]);

  const submit = () => {
    if (!complete || pending) return;
    setError(null);
    start(async () => {
      const res = await submitReviewAction(assignmentId, {
        scores: rubric ? scores : {},
        recommendation: rec!,
        notes: notes || undefined,
        acceptedFromAi: fromAi,
      });
      if (!res.ok) return setError(res.error);
      setDone(
        res.outcome === "second_reviewer"
          ? "Saved. The score is close to the cut-off, so a second reviewer will take a look."
          : res.outcome === "waiting"
            ? "Saved. Waiting for the other reviewer."
            : "Saved. The candidate's next step has been worked out.",
      );
      router.refresh();
    });
  };

  // Keyboard: digits score the focused criterion and move on; ↑/↓ (or k/j) move; ⌘/Ctrl+Enter submits.
  useEffect(() => {
    if (readOnly || !rubric) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        submit();
        return;
      }
      if (
        target.tagName === "TEXTAREA" ||
        target.tagName === "INPUT" ||
        target.tagName === "SELECT"
      )
        return;
      const n = rubric.criteria.length;
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        setFocus((f) => Math.min(n, f + 1));
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        setFocus((f) => Math.max(0, f - 1));
      } else if (/^[0-9]$/.test(e.key) && focus < n) {
        const v = e.key === "0" && max(rubric) === 10 ? 10 : Number(e.key);
        if (v < min(rubric) || v > max(rubric)) return;
        const c = rubric.criteria[focus]!;
        setScores((s) => ({ ...s, [c.id]: v }));
        setFromAi(false);
        setFocus((f) => Math.min(n, f + 1));
      } else if (focus === n && ["y", "Y", "n", "N"].includes(e.key)) {
        setRec(
          e.key === "Y" ? "strong_yes" : e.key === "y" ? "yes" : e.key === "n" ? "no" : "strong_no",
        );
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <Card className="p-0">
      <div className="h-1.5 rounded-t-card" style={{ background: "var(--accent-gradient)" }} />
      <div className="p-6">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="font-display text-xl font-bold">
            {readOnly ? "Your review" : "Score it"}
          </h2>
          {pct !== null && (
            <p className="font-display text-3xl font-bold tabular-nums" aria-live="polite">
              {pct}
              <span className="text-lg text-muted">%</span>
            </p>
          )}
        </div>

        {error && <Alert>{error}</Alert>}
        {done && <Alert tone="success">{done}</Alert>}

        {ai && !readOnly && (
          <div className="mb-5 rounded-xl border border-brand-500/30 bg-brand-soft px-4 py-3">
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <Sparkles size={16} aria-hidden /> Claude suggests {ai.totalPct}%
            </p>
            {ai.notes && <p className="mt-1 whitespace-pre-wrap text-sm">{ai.notes}</p>}
            <Btn
              size="sm"
              variant="secondary"
              className="mt-2"
              onClick={() => {
                setScores(ai.scores);
                setFromAi(true);
              }}
            >
              Use these scores
            </Btn>
            <p className="mt-1 text-xs text-muted">
              A suggestion only. Check it against the submission before you submit.
            </p>
          </div>
        )}
        {!ai && aiEnabled && (
          <Btn
            size="sm"
            variant="secondary"
            className="mb-5"
            disabled={aiPending}
            onClick={() =>
              startAi(async () => {
                const res = await requestAiAction(assignmentId);
                if (!res.ok) setError(res.error);
                else router.refresh();
              })
            }
          >
            <Sparkles size={16} aria-hidden />{" "}
            {aiPending ? "Asking Claude…" : "Ask Claude for a first pass"}
          </Btn>
        )}

        {rubric && (
          <ol className="space-y-4">
            {rubric.criteria.map((c, i) => {
              const values = Array.from(
                { length: max(rubric) - min(rubric) + 1 },
                (_, k) => k + min(rubric),
              );
              const v = scores[c.id];
              const anchor = v !== undefined ? c.anchors?.[String(v)] : undefined;
              return (
                <li
                  key={c.id}
                  onClick={() => setFocus(i)}
                  className={`rounded-xl p-3 transition ${focus === i && !readOnly ? "bg-neutral-bg ring-2 ring-brand-500" : ""}`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="font-semibold">
                      {c.name}
                      {c.mustPassMin !== undefined && (
                        <span className="ml-1.5 text-xs font-normal text-warning-fg">
                          must reach {c.mustPassMin}
                        </span>
                      )}
                    </p>
                    <span className="text-xs text-muted">weight {c.weight}</span>
                  </div>
                  {c.description && <p className="text-sm text-muted">{c.description}</p>}
                  <div
                    role="radiogroup"
                    aria-label={c.name}
                    className="mt-2 flex flex-wrap gap-1.5"
                  >
                    {values.map((n) => (
                      <button
                        key={n}
                        type="button"
                        role="radio"
                        aria-checked={v === n}
                        disabled={readOnly}
                        onClick={() => {
                          setScores((s) => ({ ...s, [c.id]: n }));
                          setFromAi(false);
                          setFocus(Math.min(rubric.criteria.length, i + 1));
                        }}
                        className={`h-9 min-w-9 rounded-lg px-2 text-sm font-bold tabular-nums transition ${
                          v === n
                            ? "bg-brand-500 text-white shadow-card"
                            : "border border-border bg-surface hover:border-brand-500"
                        } ${ai && ai.scores[c.id] === n && v !== n ? "ring-2 ring-brand-500/40" : ""}`}
                      >
                        {rubric.scale === "pass-fail" ? (n ? "Pass" : "Fail") : n}
                      </button>
                    ))}
                  </div>
                  {anchor && <p className="mt-1.5 text-sm text-muted">“{anchor}”</p>}
                  {ai?.evidence[c.id] && !readOnly && (
                    <p className="mt-1.5 text-xs text-muted">Claude: {ai.evidence[c.id]}</p>
                  )}
                </li>
              );
            })}
          </ol>
        )}

        <fieldset
          className={`mt-5 rounded-xl p-3 ${rubric && focus === rubric.criteria.length && !readOnly ? "ring-2 ring-brand-500" : ""}`}
        >
          <legend className="mb-2 font-semibold">Recommendation</legend>
          <div className="grid grid-cols-2 gap-2">
            {RECS.map((r) => (
              <button
                key={r.id}
                type="button"
                disabled={readOnly}
                aria-pressed={rec === r.id}
                onClick={() => setRec(r.id)}
                className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
                  rec === r.id
                    ? `${r.tone} ring-2 ring-current`
                    : "border border-border bg-surface hover:bg-neutral-bg"
                }`}
              >
                {rec === r.id && <Check size={14} className="mr-1 inline" aria-hidden />}
                {r.label}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="mt-4 block text-sm font-semibold" htmlFor="notes">
          Notes for the team
        </label>
        <TextArea
          id="notes"
          value={notes}
          readOnly={readOnly}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What stood out? Anything to probe in an interview?"
          className="mt-1"
        />

        {!readOnly && (
          <>
            <Btn
              variant="gradient"
              className="mt-4 w-full"
              disabled={!complete || pending}
              onClick={submit}
            >
              {pending ? "Submitting…" : "Submit review"}
            </Btn>
            <p className="mt-3 flex items-start gap-1.5 text-xs text-muted">
              <Keyboard size={14} className="mt-px shrink-0" aria-hidden />
              Number keys score and move on · ↑↓ or j/k to move · y / Y / n / N for the
              recommendation · Ctrl+Enter submits
            </p>
          </>
        )}
      </div>
    </Card>
  );
}
