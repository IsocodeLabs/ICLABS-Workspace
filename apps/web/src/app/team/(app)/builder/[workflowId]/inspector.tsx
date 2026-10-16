"use client";

import { useState, type ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import { ulid } from "ulid";
import {
  STAGE_TYPES,
  TERMINALS,
  defaultRubric,
  describeCondition,
  targetLabel,
  type FormField,
  type NodeOf,
  type Rubric,
  type WorkflowConfig,
  type WorkflowNode,
} from "@iclabs/core/workflow";
import { Btn, Input, Label, Select, TextArea } from "@/components/admin";
import { ConfirmDialog } from "@/components/dialog";

export type TeamOption = { id: string; email: string; role: string };

const TABS = ["Basics", "Content", "Rules", "Scoring", "Emails", "People"] as const;
type Tab = (typeof TABS)[number];

type Props = {
  node: WorkflowNode;
  config: WorkflowConfig;
  team: TeamOption[];
  readOnly: boolean;
  update: (fn: (n: WorkflowNode) => WorkflowNode) => void;
  setWeight: (weight: number) => void;
  connect: (to: string) => void;
  selectEdge: (id: string) => void;
  remove: () => void;
};

export function Inspector(props: Props) {
  const [tab, setTab] = useState<Tab>("Basics");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { node } = props;
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-5 pb-3 pt-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted">
          {STAGE_TYPES[node.type].label}
        </div>
        <div className="truncate font-display text-lg font-bold">{node.title}</div>
        <div role="tablist" aria-label="Stage settings" className="mt-3 flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`rounded-lg px-2.5 py-1 text-sm font-semibold transition ${
                tab === t ? "bg-brand-soft text-brand-soft-fg" : "text-muted hover:bg-neutral-bg"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <fieldset disabled={props.readOnly} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {tab === "Basics" && <Basics {...props} />}
        {tab === "Content" && <Content {...props} />}
        {tab === "Rules" && <Rules {...props} />}
        {tab === "Scoring" && <Scoring {...props} />}
        {tab === "Emails" && <Emails {...props} />}
        {tab === "People" && <People {...props} />}
      </fieldset>
      {!props.readOnly && (
        <div className="border-t border-border px-5 py-3">
          <Btn
            variant="ghost"
            size="sm"
            onClick={() => setConfirmDelete(true)}
            className="text-danger-fg"
          >
            <Trash2 size={16} aria-hidden /> Delete stage
          </Btn>
        </div>
      )}
      <ConfirmDialog
        open={confirmDelete}
        title={`Delete "${node.title}"?`}
        body="Its connections and score weight are removed too. You can undo this with Ctrl+Z before publishing."
        confirmLabel="Delete stage"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          props.remove();
        }}
      />
    </div>
  );
}

/** Wrapping <label> ties the caption to the control inside it for screen readers. */
function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="mb-4 block">
      <span className="mb-1 block text-sm font-semibold">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="mb-3 flex items-center gap-2 text-sm font-medium">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-[var(--brand-500)]"
      />
      {label}
    </label>
  );
}

const num = (v: string, fallback = 0) =>
  Number.isFinite(Number(v)) && v !== "" ? Number(v) : fallback;

// ─── Basics ──────────────────────────────────────────────────────────────────

function Basics({ node, update }: Props) {
  const deadline = node.deadline;
  return (
    <>
      <Row label="Title">
        <Input
          value={node.title}
          maxLength={120}
          onChange={(e) => update((n) => ({ ...n, title: e.target.value || " " }))}
        />
      </Row>
      <Row label="Instructions for this stage">
        <TextArea
          value={node.description ?? ""}
          onChange={(e) => update((n) => ({ ...n, description: e.target.value }))}
        />
      </Row>
      <Row label="Who sees it">
        <Select
          value={node.visibility}
          onChange={(e) =>
            update((n) => ({ ...n, visibility: e.target.value as WorkflowNode["visibility"] }))
          }
        >
          <option value="candidate">Candidate (they complete it)</option>
          <option value="internal">Team only (no candidate action)</option>
        </Select>
      </Row>
      {node.type !== "interview" && (
        <Row label="Deadline">
          <Select
            value={deadline?.mode ?? "none"}
            onChange={(e) => {
              const mode = e.target.value;
              update((n) => ({
                ...n,
                deadline:
                  mode === "relative"
                    ? { mode: "relative", daysAfterUnlock: 3, atTime: "23:59" }
                    : mode === "absolute"
                      ? { mode: "absolute", at: new Date(Date.now() + 7 * 864e5).toISOString() }
                      : undefined,
              }));
            }}
          >
            <option value="none">No deadline</option>
            <option value="relative">Days after the stage opens</option>
            <option value="absolute">Fixed date</option>
          </Select>
          {deadline?.mode === "relative" && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Input
                type="number"
                min={0}
                max={90}
                aria-label="Days after unlock"
                value={deadline.daysAfterUnlock}
                onChange={(e) =>
                  update((n) => ({
                    ...n,
                    deadline: { ...deadline, daysAfterUnlock: num(e.target.value, 0) },
                  }))
                }
              />
              <Input
                type="time"
                aria-label="Time of day (IST)"
                value={deadline.atTime ?? "23:59"}
                onChange={(e) =>
                  update((n) => ({ ...n, deadline: { ...deadline, atTime: e.target.value } }))
                }
              />
            </div>
          )}
          {deadline?.mode === "absolute" && (
            <Input
              className="mt-2"
              type="datetime-local"
              aria-label="Deadline date and time"
              value={deadline.at.slice(0, 16)}
              onChange={(e) =>
                e.target.value &&
                update((n) => ({
                  ...n,
                  deadline: { mode: "absolute", at: new Date(e.target.value).toISOString() },
                }))
              }
            />
          )}
        </Row>
      )}
      {(node.type === "task" || node.type === "custom" || node.type === "form") && (
        <Row
          label="Grace period (hours)"
          hint="Submissions in this window are accepted but marked late."
        >
          <Input
            type="number"
            min={0}
            max={72}
            value={node.graceHours ?? 0}
            onChange={(e) => update((n) => ({ ...n, graceHours: num(e.target.value) }))}
          />
        </Row>
      )}
    </>
  );
}

// ─── Content ─────────────────────────────────────────────────────────────────

function Content(props: Props) {
  const { node, update } = props;
  const setConfig = <T extends WorkflowNode>(patch: Partial<T["config"]>) =>
    update((n) => ({ ...n, config: { ...n.config, ...patch } }) as WorkflowNode);

  switch (node.type) {
    case "form":
      return (
        <FieldsEditor fields={node.config.fields} onChange={(fields) => setConfig({ fields })} />
      );
    case "custom":
      return (
        <>
          <Row label="Timer (minutes, optional)">
            <Input
              type="number"
              min={0}
              value={node.config.timerMin ?? ""}
              onChange={(e) =>
                setConfig({ timerMin: e.target.value ? num(e.target.value) : undefined })
              }
            />
          </Row>
          <Check
            label="Team reviews and scores this step"
            checked={node.config.reviewed}
            onChange={(reviewed) =>
              update((n) =>
                n.type === "custom"
                  ? {
                      ...n,
                      config: { ...n.config, reviewed },
                      rubric: reviewed ? (n.rubric ?? defaultRubric()) : n.rubric,
                      reviewers: reviewed
                        ? (n.reviewers ?? {
                            pool: [],
                            perSubmission: 1,
                            method: "round_robin",
                            blind: false,
                          })
                        : n.reviewers,
                    }
                  : n,
              )
            }
          />
          <FieldsEditor fields={node.config.fields} onChange={(fields) => setConfig({ fields })} />
        </>
      );
    case "assessment":
      return <AssessmentContent node={node} setConfig={setConfig} />;
    case "task":
      return <TaskContent node={node} setConfig={setConfig} />;
    case "review_gate":
      return (
        <Row label="Instructions for reviewers">
          <TextArea
            value={node.config.instructions ?? ""}
            onChange={(e) => setConfig({ instructions: e.target.value })}
          />
        </Row>
      );
    case "interview":
      return <InterviewContent node={node} setConfig={setConfig} team={props.team} />;
  }
}

function AssessmentContent({
  node,
  setConfig,
}: {
  node: NodeOf<"assessment">;
  setConfig: (patch: Partial<NodeOf<"assessment">["config"]>) => void;
}) {
  const c = node.config;
  const draws = c.questions.draw;
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Row label="Time limit (min)">
          <Input
            type="number"
            min={1}
            max={240}
            value={c.durationMin}
            onChange={(e) => setConfig({ durationMin: num(e.target.value, 1) })}
          />
        </Row>
        <Row label="Pass mark (%)">
          <Input
            type="number"
            min={0}
            max={100}
            value={c.passMark ?? ""}
            onChange={(e) =>
              setConfig({ passMark: e.target.value ? num(e.target.value) : undefined })
            }
          />
        </Row>
      </div>
      <Check
        label="Shuffle question order"
        checked={c.shuffleQuestions}
        onChange={(v) => setConfig({ shuffleQuestions: v })}
      />
      <Check
        label="Shuffle answer options"
        checked={c.shuffleOptions}
        onChange={(v) => setConfig({ shuffleOptions: v })}
      />
      <Label>Questions drawn from the bank</Label>
      <p className="mb-2 text-xs text-muted">
        Each candidate gets a random set matching these tags. Pick fixed questions in the Question
        bank.
      </p>
      {draws.map((d, i) => (
        <div key={i} className="mb-2 grid grid-cols-[1fr_6rem_4.5rem_auto] items-center gap-2">
          <Input
            aria-label="Tags"
            placeholder="sql, joins"
            value={d.tags.join(", ")}
            onChange={(e) => {
              const tags = e.target.value
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean);
              setConfig({
                questions: {
                  ...c.questions,
                  draw: draws.map((x, j) =>
                    j === i ? { ...x, tags: tags.length ? tags : [""] } : x,
                  ),
                },
              });
            }}
          />
          <Select
            aria-label="Difficulty"
            value={d.difficulty ?? ""}
            onChange={(e) =>
              setConfig({
                questions: {
                  ...c.questions,
                  draw: draws.map((x, j) =>
                    j === i
                      ? { ...x, difficulty: (e.target.value || undefined) as typeof x.difficulty }
                      : x,
                  ),
                },
              })
            }
          >
            <option value="">Any</option>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </Select>
          <Input
            aria-label="Number of questions"
            type="number"
            min={1}
            value={d.count}
            onChange={(e) =>
              setConfig({
                questions: {
                  ...c.questions,
                  draw: draws.map((x, j) =>
                    j === i ? { ...x, count: num(e.target.value, 1) } : x,
                  ),
                },
              })
            }
          />
          <Btn
            variant="ghost"
            size="sm"
            aria-label="Remove draw rule"
            onClick={() =>
              setConfig({ questions: { ...c.questions, draw: draws.filter((_, j) => j !== i) } })
            }
          >
            <Trash2 size={15} />
          </Btn>
        </div>
      ))}
      <Btn
        variant="secondary"
        size="sm"
        onClick={() =>
          setConfig({
            questions: { ...c.questions, draw: [...draws, { tags: ["general"], count: 10 }] },
          })
        }
      >
        <Plus size={15} /> Add question set
      </Btn>
      {c.questions.fixed.length > 0 && (
        <p className="mt-3 text-sm text-muted">+ {c.questions.fixed.length} fixed questions</p>
      )}
    </>
  );
}

function TaskContent({
  node,
  setConfig,
}: {
  node: NodeOf<"task">;
  setConfig: (patch: Partial<NodeOf<"task">["config"]>) => void;
}) {
  const c = node.config;
  return (
    <>
      <Row label="Task brief" hint="What the candidate should build or write. Markdown is fine.">
        <TextArea
          className="min-h-40"
          value={c.brief}
          onChange={(e) => setConfig({ brief: e.target.value })}
        />
      </Row>
      <Label>Deliverables</Label>
      {c.deliverables.map((d, i) => (
        <div key={d.id} className="mb-2 grid grid-cols-[6rem_1fr_auto_auto] items-center gap-2">
          <Select
            aria-label="Deliverable type"
            value={d.kind}
            onChange={(e) =>
              setConfig({
                deliverables: c.deliverables.map((x, j) =>
                  j === i ? { ...x, kind: e.target.value as typeof x.kind } : x,
                ),
              })
            }
          >
            <option value="link">Link</option>
            <option value="file">File</option>
            <option value="text">Text</option>
          </Select>
          <Input
            aria-label="Deliverable label"
            value={d.label}
            onChange={(e) =>
              setConfig({
                deliverables: c.deliverables.map((x, j) =>
                  j === i ? { ...x, label: e.target.value } : x,
                ),
              })
            }
          />
          <label className="flex items-center gap-1 text-xs font-medium">
            <input
              type="checkbox"
              checked={d.required}
              onChange={(e) =>
                setConfig({
                  deliverables: c.deliverables.map((x, j) =>
                    j === i ? { ...x, required: e.target.checked } : x,
                  ),
                })
              }
            />
            Required
          </label>
          <Btn
            variant="ghost"
            size="sm"
            aria-label="Remove deliverable"
            onClick={() => setConfig({ deliverables: c.deliverables.filter((_, j) => j !== i) })}
          >
            <Trash2 size={15} />
          </Btn>
        </div>
      ))}
      <Btn
        variant="secondary"
        size="sm"
        onClick={() =>
          setConfig({
            deliverables: [
              ...c.deliverables,
              { id: ulid(), kind: "link", label: "GitHub repository", required: true },
            ],
          })
        }
      >
        <Plus size={15} /> Add deliverable
      </Btn>
      <div className="mt-4">
        <Check
          label="Allow resubmission until the deadline"
          checked={c.allowResubmit}
          onChange={(v) => setConfig({ allowResubmit: v })}
        />
      </div>
    </>
  );
}

function InterviewContent({
  node,
  setConfig,
  team,
}: {
  node: NodeOf<"interview">;
  setConfig: (patch: Partial<NodeOf<"interview">["config"]>) => void;
  team: TeamOption[];
}) {
  const c = node.config;
  return (
    <>
      <Row label="Round name">
        <Input
          value={c.roundName}
          onChange={(e) => setConfig({ roundName: e.target.value || "Interview" })}
        />
      </Row>
      <div className="grid grid-cols-2 gap-3">
        <Row label="Length">
          <Select
            value={c.durationMin}
            onChange={(e) => setConfig({ durationMin: Number(e.target.value) as 30 | 45 | 60 })}
          >
            <option value={30}>30 min</option>
            <option value={45}>45 min</option>
            <option value={60}>60 min</option>
          </Select>
        </Row>
        <Row label="Mode">
          <Select
            value={c.mode}
            onChange={(e) => setConfig({ mode: e.target.value as typeof c.mode })}
          >
            <option value="meet">Google Meet</option>
            <option value="phone">Phone</option>
            <option value="in_person">In person</option>
          </Select>
        </Row>
      </div>
      {c.mode === "in_person" && (
        <Row label="Address">
          <TextArea
            value={c.address ?? ""}
            onChange={(e) => setConfig({ address: e.target.value })}
          />
        </Row>
      )}
      <Row label="Instructions for the candidate">
        <TextArea
          value={c.instructions ?? ""}
          onChange={(e) => setConfig({ instructions: e.target.value })}
        />
      </Row>
      <PeoplePicker
        label="Interviewers"
        team={team}
        selected={c.interviewerPool}
        onChange={(interviewerPool) => setConfig({ interviewerPool })}
      />
    </>
  );
}

const FIELD_KINDS: [FormField["kind"], string][] = [
  ["short_text", "Short text"],
  ["long_text", "Long text"],
  ["email", "Email"],
  ["phone", "Phone"],
  ["number", "Number"],
  ["date", "Date"],
  ["url", "Link"],
  ["single_choice", "Single choice"],
  ["multi_choice", "Multiple choice"],
  ["file", "File upload"],
  ["rating", "Rating 1–5"],
  ["section", "Section heading"],
];

function FieldsEditor({
  fields,
  onChange,
}: {
  fields: FormField[];
  onChange: (f: FormField[]) => void;
}) {
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  const patch = (i: number, p: Partial<FormField>) =>
    onChange(fields.map((f, j) => (j === i ? { ...f, ...p } : f)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...fields];
    const [f] = next.splice(i, 1);
    next.splice(i + d, 0, f!);
    onChange(next);
  };
  return (
    <>
      <Label>Fields</Label>
      {fields.length === 0 && <p className="mb-2 text-sm text-muted">No fields yet.</p>}
      <ol className="space-y-2">
        {fields.map((f, i) => (
          <li key={f.id} className="rounded-xl border border-border p-3">
            <div className="grid grid-cols-[1fr_8.5rem] gap-2">
              <Input
                aria-label="Field label"
                value={f.label}
                onChange={(e) => patch(i, { label: e.target.value || " " })}
              />
              <Select
                aria-label="Field type"
                value={f.kind}
                onChange={(e) => patch(i, { kind: e.target.value as FormField["kind"] })}
              >
                {FIELD_KINDS.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
            </div>
            {(f.kind === "single_choice" || f.kind === "multi_choice") && (
              <TextArea
                className="mt-2 min-h-16"
                aria-label="Options, one per line"
                placeholder="One option per line"
                value={(f.options ?? []).join("\n")}
                onChange={(e) => patch(i, { options: e.target.value.split("\n") })}
              />
            )}
            {f.kind === "url" && (
              <Input
                className="mt-2"
                aria-label="Allowed sites"
                placeholder="Allowed sites, e.g. github.com (optional)"
                value={(f.allowedDomains ?? []).join(", ")}
                onChange={(e) =>
                  patch(i, {
                    allowedDomains: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
            )}
            <div className="mt-2 flex items-center gap-1">
              <label className="mr-auto flex items-center gap-1.5 text-xs font-medium">
                <input
                  type="checkbox"
                  checked={f.required}
                  onChange={(e) => patch(i, { required: e.target.checked })}
                />{" "}
                Required
              </label>
              <Btn
                size="sm"
                variant="ghost"
                aria-label="Move up"
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                ↑
              </Btn>
              <Btn
                size="sm"
                variant="ghost"
                aria-label="Move down"
                disabled={i === fields.length - 1}
                onClick={() => move(i, 1)}
              >
                ↓
              </Btn>
              <Btn
                size="sm"
                variant="ghost"
                aria-label="Remove field"
                onClick={() => setPendingDelete(i)}
              >
                <Trash2 size={15} />
              </Btn>
            </div>
          </li>
        ))}
      </ol>
      <Btn
        className="mt-3"
        variant="secondary"
        size="sm"
        onClick={() =>
          onChange([
            ...fields,
            { id: ulid(), label: "New question", kind: "short_text", required: true },
          ])
        }
      >
        <Plus size={15} /> Add field
      </Btn>
      <ConfirmDialog
        open={pendingDelete !== null}
        title="Remove this field?"
        body="Answers already collected for it stay in past submissions."
        confirmLabel="Remove field"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          onChange(fields.filter((_, j) => j !== pendingDelete));
          setPendingDelete(null);
        }}
      />
    </>
  );
}

// ─── Rules ───────────────────────────────────────────────────────────────────

function Rules({ node, config, connect, selectEdge, readOnly }: Props) {
  const titles = Object.fromEntries(config.nodes.map((n) => [n.id, n.title]));
  const outs = config.edges
    .filter((e) => e.from === node.id)
    .sort((a, b) => a.priority - b.priority);
  const targets = [
    ...config.nodes.filter((n) => n.id !== node.id).map((n) => n.id),
    ...TERMINALS,
  ].filter((t) => !outs.some((e) => e.to === t));
  return (
    <>
      <p className="mb-3 text-sm text-muted">
        Checked top to bottom when a candidate finishes this stage. The first match wins.
      </p>
      <ol className="space-y-2">
        {outs.map((e, i) => (
          <li key={e.id}>
            <button
              onClick={() => selectEdge(e.id)}
              className="w-full rounded-xl border border-border px-3 py-2 text-left text-sm hover:border-brand-500"
            >
              <span className="text-muted">{i + 1}. </span>
              <span className="font-semibold">{describeCondition(e.when)}</span> →{" "}
              {targetLabel(e.to, titles)}
              {e.autoReject && <span className="ml-1 text-danger-fg">(auto-reject)</span>}
            </button>
          </li>
        ))}
      </ol>
      {outs.length === 0 && (
        <p className="text-sm text-muted">
          No paths yet. Drag from the card's right dot, or add one:
        </p>
      )}
      {!readOnly && targets.length > 0 && (
        <Select
          className="mt-3"
          value=""
          aria-label="Add a path to"
          onChange={(e) => e.target.value && connect(e.target.value)}
        >
          <option value="">+ Add a path to…</option>
          {targets.map((t) => (
            <option key={t} value={t}>
              {targetLabel(t, titles)}
            </option>
          ))}
        </Select>
      )}
    </>
  );
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

function Scoring({ node, config, update, setWeight }: Props) {
  const reviewable =
    STAGE_TYPES[node.type].reviewable || (node.type === "custom" && node.config.reviewed);
  const total = Object.values(config.scoring.weights).reduce((a, b) => a + b, 0);
  return (
    <>
      <Row
        label="Weight in the overall score (%)"
        hint={`All stage weights currently add up to ${total}%. They must total 100% (or all be 0).`}
      >
        <Input
          type="number"
          min={0}
          max={100}
          value={config.scoring.weights[node.id] ?? 0}
          onChange={(e) => setWeight(num(e.target.value))}
        />
      </Row>
      {node.type === "assessment" && (
        <p className="text-sm text-muted">
          Multiple-choice answers are graded automatically. Written answers use the rubric below if
          you add one.
        </p>
      )}
      {reviewable || node.type === "assessment" ? (
        <RubricEditor
          rubric={node.rubric}
          onChange={(rubric) => update((n) => ({ ...n, rubric }))}
        />
      ) : (
        <p className="text-sm text-muted">This stage isn't scored by reviewers.</p>
      )}
    </>
  );
}

function RubricEditor({
  rubric,
  onChange,
}: {
  rubric?: Rubric;
  onChange: (r: Rubric | undefined) => void;
}) {
  if (!rubric) {
    return (
      <Btn variant="secondary" size="sm" onClick={() => onChange(defaultRubric())}>
        <Plus size={15} /> Add a rubric
      </Btn>
    );
  }
  const patch = (i: number, p: Partial<Rubric["criteria"][number]>) =>
    onChange({
      ...rubric,
      criteria: rubric.criteria.map((c, j) => (j === i ? { ...c, ...p } : c)),
    });
  return (
    <>
      <Row label="Scale">
        <Select
          value={rubric.scale}
          onChange={(e) => onChange({ ...rubric, scale: e.target.value as Rubric["scale"] })}
        >
          <option value="1-5">1 to 5</option>
          <option value="1-10">1 to 10</option>
          <option value="pass-fail">Pass / fail</option>
        </Select>
      </Row>
      <Label>Criteria</Label>
      {rubric.criteria.map((c, i) => (
        <div key={c.id} className="mb-2 rounded-xl border border-border p-3">
          <div className="grid grid-cols-[1fr_5rem_auto] items-center gap-2">
            <Input
              aria-label="Criterion name"
              value={c.name}
              onChange={(e) => patch(i, { name: e.target.value || " " })}
            />
            <Input
              aria-label="Weight"
              type="number"
              min={0}
              max={100}
              value={c.weight}
              onChange={(e) => patch(i, { weight: num(e.target.value) })}
            />
            <Btn
              variant="ghost"
              size="sm"
              aria-label="Remove criterion"
              onClick={() =>
                onChange({ ...rubric, criteria: rubric.criteria.filter((_, j) => j !== i) })
              }
            >
              <Trash2 size={15} />
            </Btn>
          </div>
          <TextArea
            className="mt-2 min-h-14"
            aria-label="What good looks like"
            placeholder="What does a strong answer look like?"
            value={c.description ?? ""}
            onChange={(e) => patch(i, { description: e.target.value })}
          />
          <div className="mt-2 flex items-center gap-2 text-xs">
            <span className="font-medium">Must score at least</span>
            <Input
              aria-label="Minimum score to pass"
              className="!w-20 !py-1"
              type="number"
              value={c.mustPassMin ?? ""}
              onChange={(e) =>
                patch(i, { mustPassMin: e.target.value ? num(e.target.value) : undefined })
              }
            />
            <span className="text-muted">(optional)</span>
          </div>
        </div>
      ))}
      <Btn
        variant="secondary"
        size="sm"
        onClick={() =>
          onChange({
            ...rubric,
            criteria: [...rubric.criteria, { id: ulid(), name: "New criterion", weight: 10 }],
          })
        }
      >
        <Plus size={15} /> Add criterion
      </Btn>
    </>
  );
}

// ─── Emails & People ─────────────────────────────────────────────────────────

const EMAIL_EVENTS = [
  ["unlock", "When the stage opens"],
  ["reminder", "24h before the deadline"],
  ["submitted", "After they submit"],
] as const;

function Emails({ node }: Props) {
  return (
    <>
      <p className="mb-3 text-sm text-muted">
        Emails sent to the candidate for this stage. Edit wording under Settings → Email templates.
      </p>
      {node.visibility === "internal" ? (
        <p className="text-sm text-muted">Team-only stages don't email candidates.</p>
      ) : (
        <ul className="space-y-2">
          {EMAIL_EVENTS.map(([key, label]) => (
            <li
              key={key}
              className="flex items-center justify-between rounded-xl border border-border px-3 py-2 text-sm"
            >
              <span>{label}</span>
              <span className="text-muted">
                {node.emails?.[key] ? "Custom" : "Default template"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function People({ node, team, update }: Props) {
  const reviewers = node.reviewers;
  if (!reviewers) {
    return (
      <p className="text-sm text-muted">
        {node.type === "interview"
          ? "Pick interviewers under Content."
          : "No reviewers needed for this stage."}
      </p>
    );
  }
  const set = (p: Partial<typeof reviewers>) =>
    update((n) => ({ ...n, reviewers: { ...reviewers, ...p } }));
  return (
    <>
      <PeoplePicker
        label="Reviewer pool"
        team={team}
        selected={reviewers.pool}
        onChange={(pool) => set({ pool })}
      />
      <div className="grid grid-cols-2 gap-3">
        <Row label="Reviewers per submission">
          <Select
            value={reviewers.perSubmission}
            onChange={(e) => set({ perSubmission: Number(e.target.value) as 1 | 2 })}
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
          </Select>
        </Row>
        <Row label="Assign by">
          <Select
            value={reviewers.method}
            onChange={(e) => set({ method: e.target.value as typeof reviewers.method })}
          >
            <option value="round_robin">Taking turns</option>
            <option value="load">Lightest queue</option>
            <option value="manual">Manually</option>
          </Select>
        </Row>
      </div>
      <Check
        label="Second reviewer for borderline scores"
        checked={!!reviewers.borderline}
        onChange={(v) => set({ borderline: v ? { cutoff: 60, band: 8 } : undefined })}
      />
      {reviewers.borderline && (
        <div className="mb-4 grid grid-cols-2 gap-3">
          <Row label="Cut-off (%)">
            <Input
              type="number"
              value={reviewers.borderline.cutoff}
              onChange={(e) =>
                set({ borderline: { ...reviewers.borderline!, cutoff: num(e.target.value) } })
              }
            />
          </Row>
          <Row label="± band (%)">
            <Input
              type="number"
              value={reviewers.borderline.band}
              onChange={(e) =>
                set({ borderline: { ...reviewers.borderline!, band: num(e.target.value) } })
              }
            />
          </Row>
        </div>
      )}
      <Check
        label="Blind review (hide name and college)"
        checked={reviewers.blind}
        onChange={(blind) => set({ blind })}
      />
    </>
  );
}

function PeoplePicker({
  label,
  team,
  selected,
  onChange,
}: {
  label: string;
  team: TeamOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <div className="mb-4">
      <Label>{label}</Label>
      {team.length === 0 ? (
        <p className="text-sm text-muted">Add team members under Team first.</p>
      ) : (
        <ul className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-border p-2">
          {team.map((m) => (
            <li key={m.id}>
              <label className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-neutral-bg">
                <input
                  type="checkbox"
                  checked={selected.includes(m.id)}
                  onChange={(e) =>
                    onChange(
                      e.target.checked ? [...selected, m.id] : selected.filter((x) => x !== m.id),
                    )
                  }
                />
                <span className="truncate">{m.email}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
