"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import {
  describeCondition,
  targetLabel,
  type Condition,
  type WorkflowConfig,
  type WorkflowEdge,
} from "@iclabs/core/workflow";
import { Btn, Input, Label, Select } from "@/components/admin";
import { ConfirmDialog } from "@/components/dialog";

type RuleKind =
  | "always"
  | "auto_score_pct"
  | "rubric_pct"
  | "composite"
  | "criterion"
  | "answer"
  | "rank"
  | "consensus"
  | "late";

const KIND_LABELS: [RuleKind, string][] = [
  ["always", "Otherwise (everyone else)"],
  ["auto_score_pct", "Quiz score"],
  ["rubric_pct", "Review score"],
  ["composite", "Overall score"],
  ["criterion", "One rubric criterion"],
  ["answer", "Answer to a form question"],
  ["rank", "Top candidates"],
  ["consensus", "Reviewer agreement"],
  ["late", "Submitted late"],
];

function kindOf(when: WorkflowEdge["when"]): RuleKind | "group" {
  if ("always" in when) return "always";
  if ("metric" in when) return when.metric;
  if ("criterion" in when) return "criterion";
  if ("answer" in when) return "answer";
  if ("rank" in when) return "rank";
  if ("consensus" in when) return "consensus";
  if ("flag" in when) return "late";
  return "group";
}

function defaultFor(kind: RuleKind): WorkflowEdge["when"] {
  switch (kind) {
    case "always":
      return { always: true };
    case "auto_score_pct":
    case "rubric_pct":
    case "composite":
      return { metric: kind, op: ">=", value: 60 };
    case "criterion":
      return { criterion: "", op: ">=", value: 3 };
    case "answer":
      return { answer: { fieldId: "", op: "eq", value: "" } };
    case "rank":
      return { rank: { by: "composite", top: 10 } };
    case "consensus":
      return { consensus: "majority_yes" };
    case "late":
      return { flag: "late" };
  }
}

const OPS = [">=", ">", "<=", "<", "=="] as const;

export function EdgeInspector({
  edge,
  config,
  readOnly,
  update,
  remove,
  reorder,
}: {
  edge: WorkflowEdge;
  config: WorkflowConfig;
  readOnly: boolean;
  update: (patch: Partial<WorkflowEdge>) => void;
  remove: () => void;
  reorder: (direction: -1 | 1) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmAuto, setConfirmAuto] = useState(false);
  const titles = Object.fromEntries(config.nodes.map((n) => [n.id, n.title]));
  const source = config.nodes.find((n) => n.id === edge.from);
  const kind = kindOf(edge.when);
  const when = edge.when as Condition;
  const criteria = source?.rubric?.criteria ?? [];
  const fields =
    source && (source.type === "form" || source.type === "custom") ? source.config.fields : [];

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-5 pb-3 pt-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted">Path</div>
        <div className="font-display text-lg font-bold">
          {titles[edge.from]} → {targetLabel(edge.to, titles)}
        </div>
        <p className="mt-1 text-sm text-muted">{describeCondition(edge.when)}</p>
      </div>
      <fieldset disabled={readOnly} className="flex-1 overflow-y-auto px-5 py-4">
        <div className="mb-4">
          <Label>Candidates take this path when</Label>
          {kind === "group" ? (
            <p className="text-sm text-muted">
              This rule combines several conditions (set up with Claude or a template).
            </p>
          ) : (
            <Select
              value={kind}
              onChange={(e) => update({ when: defaultFor(e.target.value as RuleKind) })}
            >
              {KIND_LABELS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          )}
        </div>

        {"metric" in when && (
          <div className="mb-4 grid grid-cols-[6rem_1fr] gap-2">
            <Select
              aria-label="Comparison"
              value={when.op}
              onChange={(e) =>
                update({ when: { ...when, op: e.target.value as (typeof OPS)[number] } })
              }
            >
              {OPS.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </Select>
            <Input
              aria-label="Percent"
              type="number"
              min={0}
              max={100}
              value={when.value}
              onChange={(e) => update({ when: { ...when, value: Number(e.target.value) } })}
            />
          </div>
        )}

        {"criterion" in when && (
          <div className="mb-4 space-y-2">
            <Select
              aria-label="Criterion"
              value={when.criterion}
              onChange={(e) => update({ when: { ...when, criterion: e.target.value } })}
            >
              <option value="">Pick a criterion…</option>
              {criteria.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <div className="grid grid-cols-[6rem_1fr] gap-2">
              <Select
                aria-label="Comparison"
                value={when.op}
                onChange={(e) =>
                  update({ when: { ...when, op: e.target.value as (typeof OPS)[number] } })
                }
              >
                {OPS.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </Select>
              <Input
                aria-label="Score"
                type="number"
                value={when.value}
                onChange={(e) => update({ when: { ...when, value: Number(e.target.value) } })}
              />
            </div>
          </div>
        )}

        {"answer" in when && (
          <div className="mb-4 space-y-2">
            <Select
              aria-label="Question"
              value={when.answer.fieldId}
              onChange={(e) =>
                update({ when: { answer: { ...when.answer, fieldId: e.target.value } } })
              }
            >
              <option value="">Pick a question…</option>
              {fields.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Match"
              value={when.answer.op}
              onChange={(e) =>
                update({
                  when: { answer: { ...when.answer, op: e.target.value as "eq" | "contains" } },
                })
              }
            >
              <option value="eq">is exactly</option>
              <option value="contains">contains</option>
            </Select>
            <Input
              aria-label="Answer"
              value={
                Array.isArray(when.answer.value) ? when.answer.value.join(", ") : when.answer.value
              }
              onChange={(e) =>
                update({ when: { answer: { ...when.answer, value: e.target.value } } })
              }
            />
          </div>
        )}

        {"rank" in when && (
          <div className="mb-4 grid grid-cols-2 gap-2">
            <Input
              aria-label="How many"
              type="number"
              min={1}
              value={when.rank.top ?? ""}
              onChange={(e) =>
                update({ when: { rank: { by: when.rank.by, top: Number(e.target.value) || 1 } } })
              }
            />
            <Select
              aria-label="Ranked by"
              value={when.rank.by}
              onChange={(e) =>
                update({
                  when: {
                    rank: { ...when.rank, by: e.target.value as "composite" | "rubric_pct" },
                  },
                })
              }
            >
              <option value="composite">by overall score</option>
              <option value="rubric_pct">by review score</option>
            </Select>
            <p className="col-span-2 text-xs text-muted">
              Ranking runs when the stage's deadline closes, or when you click "Run rules now".
            </p>
          </div>
        )}

        {"consensus" in when && (
          <Select
            className="mb-4"
            aria-label="Agreement"
            value={when.consensus}
            onChange={(e) => update({ when: { consensus: e.target.value as "all_yes" } })}
          >
            <option value="all_yes">All reviewers say yes</option>
            <option value="majority_yes">Most reviewers say yes</option>
            <option value="any_strong_no">Any reviewer says strong no</option>
          </Select>
        )}

        <div className="mb-4 flex items-center gap-2">
          <span className="text-sm font-semibold">Order</span>
          <Btn size="sm" variant="secondary" aria-label="Check earlier" onClick={() => reorder(-1)}>
            <ArrowUp size={15} />
          </Btn>
          <Btn size="sm" variant="secondary" aria-label="Check later" onClick={() => reorder(1)}>
            <ArrowDown size={15} />
          </Btn>
        </div>

        {edge.to === "END_REJECT" && (
          <div className="rounded-xl border border-border p-3">
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={!!edge.autoReject}
                onChange={(e) =>
                  e.target.checked ? setConfirmAuto(true) : update({ autoReject: false })
                }
              />
              Reject automatically
            </label>
            <p className="mt-1 text-xs text-muted">
              Off: candidates land in "Needs decision" for a person to confirm. On: they're rejected
              and emailed without review.
            </p>
          </div>
        )}
      </fieldset>
      {!readOnly && (
        <div className="border-t border-border px-5 py-3">
          <Btn
            variant="ghost"
            size="sm"
            className="text-danger-fg"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 size={16} aria-hidden /> Delete path
          </Btn>
        </div>
      )}
      <ConfirmDialog
        open={confirmDelete}
        title="Delete this path?"
        body="Candidates matching this rule will fall through to the next one."
        confirmLabel="Delete path"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          remove();
        }}
      />
      <ConfirmDialog
        open={confirmAuto}
        title="Reject candidates automatically?"
        body="Candidates who match this rule will be rejected and emailed without anyone reviewing them. You can turn this off at any time before publishing."
        confirmLabel="Turn on auto-reject"
        onCancel={() => setConfirmAuto(false)}
        onConfirm={() => {
          setConfirmAuto(false);
          update({ autoReject: true });
        }}
      />
    </div>
  );
}
