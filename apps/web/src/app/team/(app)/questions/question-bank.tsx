"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Btn, Card, Input, Select, TextArea } from "@/components/admin";
import { Dialog } from "@/components/dialog";
import { Alert, StatusPill } from "@/components/ui";
import { saveQuestionAction, setQuestionStatusAction } from "./actions";

type Q = {
  id: string;
  type: "mcq" | "multi" | "short" | "long";
  body: string;
  options: { id: string; text: string; correct: boolean }[];
  explanation: string;
  tags: string[];
  difficulty: "easy" | "medium" | "hard";
  points: number;
  status: "draft" | "approved" | "archived";
  source: "human" | "claude";
};

const TYPE_LABEL = {
  mcq: "Single choice",
  multi: "Multiple choice",
  short: "Short answer",
  long: "Written answer",
};
const STATUS_TONE = { draft: "warning", approved: "success", archived: "neutral" } as const;

export function QuestionBank({
  questions,
  isAdmin,
  filter,
}: {
  questions: Q[];
  isAdmin: boolean;
  filter: { status?: string; tag?: string; q?: string };
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Q | "new" | null>(null);
  const [pending, start] = useTransition();
  const setFilter = (key: string, value: string) => {
    const p = new URLSearchParams(filter as Record<string, string>);
    if (value) p.set(key, value);
    else p.delete(key);
    router.push(`/team/questions?${p}`);
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Input
          className="!w-64"
          placeholder="Search questions"
          defaultValue={filter.q}
          onKeyDown={(e) => e.key === "Enter" && setFilter("q", e.currentTarget.value)}
          aria-label="Search questions"
        />
        <Input
          className="!w-40"
          placeholder="Tag, e.g. sql"
          defaultValue={filter.tag}
          onKeyDown={(e) => e.key === "Enter" && setFilter("tag", e.currentTarget.value)}
          aria-label="Filter by tag"
        />
        <Select
          className="!w-40"
          value={filter.status ?? ""}
          onChange={(e) => setFilter("status", e.target.value)}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          <option value="draft">Drafts</option>
          <option value="approved">Approved</option>
          <option value="archived">Archived</option>
        </Select>
        <Btn className="ml-auto" onClick={() => setEditing("new")}>
          <Plus size={16} /> New question
        </Btn>
      </div>
      <div className="space-y-3">
        {questions.map((q) => (
          <Card key={q.id} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
                  {TYPE_LABEL[q.type]} · {q.difficulty} · {q.points} pt{q.points === 1 ? "" : "s"}
                  {q.source === "claude" && (
                    <StatusPill tone="neutral">Drafted by Claude</StatusPill>
                  )}
                </div>
                <p className="whitespace-pre-line font-medium">{q.body}</p>
                {q.options.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-sm">
                    {q.options.map((o) => (
                      <li
                        key={o.id}
                        className={o.correct ? "font-semibold text-success-fg" : "text-muted"}
                      >
                        {o.correct ? "✓ " : "· "}
                        {o.text}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-2 flex flex-wrap gap-1">
                  {q.tags.map((t) => (
                    <span
                      key={t}
                      className="rounded-full bg-neutral-bg px-2 py-0.5 text-xs font-medium text-neutral-fg"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StatusPill tone={STATUS_TONE[q.status]}>
                  {q.status[0]!.toUpperCase() + q.status.slice(1)}
                </StatusPill>
                {isAdmin && q.status !== "approved" && (
                  <Btn
                    size="sm"
                    disabled={pending}
                    onClick={() => start(() => setQuestionStatusAction(q.id, "approved"))}
                  >
                    Approve
                  </Btn>
                )}
                {isAdmin && q.status === "approved" && (
                  <Btn
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => start(() => setQuestionStatusAction(q.id, "archived"))}
                  >
                    Archive
                  </Btn>
                )}
                <Btn size="sm" variant="secondary" onClick={() => setEditing(q)}>
                  Edit
                </Btn>
              </div>
            </div>
          </Card>
        ))}
      </div>
      {editing && (
        <QuestionEditor
          initial={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function QuestionEditor({ initial, onClose }: { initial: Q | null; onClose: () => void }) {
  const [type, setType] = useState<Q["type"]>(initial?.type ?? "mcq");
  const [body, setBody] = useState(initial?.body ?? "");
  const [options, setOptions] = useState(
    initial?.options ?? [
      { id: "", text: "", correct: true },
      { id: "", text: "", correct: false },
    ],
  );
  const [explanation, setExplanation] = useState(initial?.explanation ?? "");
  const [tags, setTags] = useState(initial?.tags.join(", ") ?? "");
  const [difficulty, setDifficulty] = useState<Q["difficulty"]>(initial?.difficulty ?? "medium");
  const [points, setPoints] = useState(initial?.points ?? 1);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const objective = type === "mcq" || type === "multi";

  return (
    <Dialog
      open
      onClose={onClose}
      title={initial ? "Edit question" : "New question"}
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>
            Cancel
          </Btn>
          <Btn
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await saveQuestionAction(initial?.id ?? null, {
                  type,
                  body,
                  options,
                  explanation,
                  tags,
                  difficulty,
                  points,
                });
                if (res.ok) onClose();
                else setError(res.error);
              })
            }
          >
            Save as draft
          </Btn>
        </>
      }
    >
      {error && <Alert>{error}</Alert>}
      {initial?.status === "approved" && (
        <Alert tone="warning">
          Saving changes moves this question back to draft until it's approved again.
        </Alert>
      )}
      <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
        <label className="block">
          <span className="mb-1 block text-sm font-semibold">Type</span>
          <Select value={type} onChange={(e) => setType(e.target.value as Q["type"])}>
            {Object.entries(TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-semibold">Question</span>
          <TextArea value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
        {objective && (
          <div>
            <span className="mb-1 block text-sm font-semibold">
              Options (tick the correct {type === "mcq" ? "one" : "ones"})
            </span>
            {options.map((o, i) => (
              <div key={i} className="mb-2 flex items-center gap-2">
                <input
                  type={type === "mcq" ? "radio" : "checkbox"}
                  name="correct"
                  aria-label={`Option ${i + 1} is correct`}
                  checked={o.correct}
                  onChange={(e) =>
                    setOptions((opts) =>
                      opts.map((x, j) =>
                        type === "mcq"
                          ? { ...x, correct: j === i }
                          : j === i
                            ? { ...x, correct: e.target.checked }
                            : x,
                      ),
                    )
                  }
                />
                <Input
                  aria-label={`Option ${i + 1}`}
                  value={o.text}
                  onChange={(e) =>
                    setOptions((opts) =>
                      opts.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)),
                    )
                  }
                />
                <Btn
                  size="sm"
                  variant="ghost"
                  aria-label="Remove option"
                  disabled={options.length <= 2}
                  onClick={() => setOptions((opts) => opts.filter((_, j) => j !== i))}
                >
                  <Trash2 size={15} />
                </Btn>
              </div>
            ))}
            {options.length < 10 && (
              <Btn
                size="sm"
                variant="secondary"
                onClick={() => setOptions((o) => [...o, { id: "", text: "", correct: false }])}
              >
                <Plus size={15} /> Add option
              </Btn>
            )}
          </div>
        )}
        {!objective && (
          <label className="block">
            <span className="mb-1 block text-sm font-semibold">
              What a good answer covers (for reviewers)
            </span>
            <TextArea value={explanation} onChange={(e) => setExplanation(e.target.value)} />
          </label>
        )}
        <div className="grid grid-cols-3 gap-3">
          <label className="col-span-3 block sm:col-span-1">
            <span className="mb-1 block text-sm font-semibold">Tags</span>
            <Input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="sql, joins"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-semibold">Difficulty</span>
            <Select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value as Q["difficulty"])}
            >
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </Select>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-semibold">Points</span>
            <Input
              type="number"
              min={1}
              max={20}
              value={points}
              onChange={(e) => setPoints(Number(e.target.value) || 1)}
            />
          </label>
        </div>
      </div>
    </Dialog>
  );
}
