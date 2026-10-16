import { ulid } from "ulid";
import type { NodeOf, NodeType, Rubric, WorkflowNode } from "./schema";

/** Catalogue of stage types: palette labels, colours and behaviour flags. */
export const STAGE_TYPES: Record<
  NodeType,
  {
    label: string;
    description: string;
    color: string;
    reviewable: boolean;
    candidateFacing: boolean;
  }
> = {
  form: {
    label: "Form",
    description: "Collect details, links and files",
    color: "var(--node-form)",
    reviewable: false,
    candidateFacing: true,
  },
  assessment: {
    label: "Assessment",
    description: "Timed quiz, auto-graded where possible",
    color: "var(--node-assessment)",
    reviewable: true,
    candidateFacing: true,
  },
  task: {
    label: "Task",
    description: "Take-home brief with deliverables",
    color: "var(--node-task)",
    reviewable: true,
    candidateFacing: true,
  },
  review_gate: {
    label: "Review gate",
    description: "Team reviews and decides who moves on",
    color: "var(--node-review)",
    reviewable: true,
    candidateFacing: false,
  },
  custom: {
    label: "Custom step",
    description: "Any fields, optional timer and review",
    color: "var(--node-custom)",
    reviewable: false,
    candidateFacing: true,
  },
  interview: {
    label: "Interview",
    description: "Admin schedules a call with a Meet link",
    color: "var(--node-interview)",
    reviewable: false,
    candidateFacing: true,
  },
};

export function defaultRubric(): Rubric {
  return {
    scale: "1-5",
    criteria: [
      { id: ulid(), name: "Quality of work", weight: 50 },
      { id: ulid(), name: "Problem solving", weight: 30 },
      { id: ulid(), name: "Communication", weight: 20 },
    ],
  };
}

const defaultReviewers = () => ({
  pool: [],
  perSubmission: 1 as const,
  method: "round_robin" as const,
  blind: false,
});

const threeDays = { mode: "relative" as const, daysAfterUnlock: 3, atTime: "23:59" };

/** A new node of `type` with sensible defaults, ready to drop on the canvas. */
export function createNode<T extends NodeType>(
  type: T,
  overrides: Partial<NodeOf<T>> = {},
): NodeOf<T> {
  const base = { id: ulid(), title: STAGE_TYPES[type].label, visibility: "candidate" as const };
  const nodes: { [K in NodeType]: () => NodeOf<K> } = {
    form: () => ({ ...base, type: "form", deadline: threeDays, config: { fields: [] } }),
    assessment: () => ({
      ...base,
      type: "assessment",
      deadline: threeDays,
      config: {
        durationMin: 30,
        questions: { fixed: [], draw: [] },
        shuffleQuestions: true,
        shuffleOptions: true,
        passMark: 60,
      },
    }),
    task: () => ({
      ...base,
      type: "task",
      deadline: { ...threeDays, daysAfterUnlock: 5 },
      graceHours: 2,
      reviewers: defaultReviewers(),
      rubric: defaultRubric(),
      config: {
        brief: "",
        deliverables: [{ id: ulid(), kind: "link", label: "Link to your work", required: true }],
        allowResubmit: true,
      },
    }),
    review_gate: () => ({
      ...base,
      type: "review_gate",
      visibility: "internal",
      reviewers: defaultReviewers(),
      rubric: defaultRubric(),
      config: {},
    }),
    custom: () => ({
      ...base,
      type: "custom",
      deadline: threeDays,
      config: { fields: [], reviewed: false },
    }),
    interview: () => ({
      ...base,
      type: "interview",
      config: { roundName: "Interview", durationMin: 30, interviewerPool: [], mode: "meet" },
    }),
  };
  return { ...nodes[type](), ...overrides } as NodeOf<T>;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function questionCount(node: NodeOf<"assessment">): number {
  const { fixed, draw } = node.config.questions;
  return fixed.length + draw.reduce((sum, d) => sum + d.count, 0);
}

/** Short lines for the node's canvas card. */
export function nodeSummary(node: WorkflowNode): string[] {
  const lines: string[] = [];
  switch (node.type) {
    case "form":
      lines.push(plural(node.config.fields.length, "field"));
      break;
    case "assessment":
      lines.push(`${node.config.durationMin} min · ${questionCount(node)} questions`);
      break;
    case "task":
      lines.push(
        `${node.config.deliverables.length} deliverable${node.config.deliverables.length === 1 ? "" : "s"}`,
      );
      break;
    case "review_gate":
      lines.push("Team decision");
      break;
    case "custom":
      lines.push(
        `${plural(node.config.fields.length, "field")}${node.config.timerMin ? ` · ${node.config.timerMin} min` : ""}`,
      );
      break;
    case "interview":
      lines.push(
        `${node.config.durationMin} min · ${node.config.mode === "meet" ? "Google Meet" : node.config.mode.replace("_", " ")}`,
      );
      break;
  }
  if (node.deadline?.mode === "relative")
    lines.push(`Due ${node.deadline.daysAfterUnlock} days after unlock`);
  if (node.deadline?.mode === "absolute") lines.push(`Due ${node.deadline.at.slice(0, 10)}`);
  if (node.reviewers) {
    const n = node.reviewers.perSubmission;
    lines.push(`${n} reviewer${n === 1 ? "" : "s"}${node.reviewers.blind ? " · blind" : ""}`);
  }
  return lines;
}
