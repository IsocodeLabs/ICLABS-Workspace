import { z } from "zod";

/**
 * The workflow config stored in `workflow_versions.config`. The Process Builder canvas, the
 * progression and rule engines, and the admin MCP tools all read and write this one shape.
 */

export const NODE_TYPES = [
  "form",
  "assessment",
  "task",
  "review_gate",
  "custom",
  "interview",
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

/** Edge targets that end or pause a candidate's path instead of pointing at a stage. */
export const TERMINALS = ["NEEDS_DECISION", "END_REJECT", "END_COMPLETE"] as const;
export type Terminal = (typeof TERMINALS)[number];

const id = z.string().min(1).max(64);

export const deadlineSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("absolute"), at: z.iso.datetime({ offset: true }) }),
  z.object({
    mode: z.literal("relative"),
    daysAfterUnlock: z.number().int().min(0).max(90),
    /** Local time of day the deadline falls on, "HH:MM" in Asia/Kolkata. */
    atTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
  }),
]);
export type Deadline = z.infer<typeof deadlineSchema>;

export const criterionSchema = z.object({
  id,
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  /** Relative weight; criteria weights are normalised when scoring. */
  weight: z.number().min(0).max(100),
  /** A score below `mustPassMin` fails the whole stage. */
  mustPassMin: z.number().optional(),
  /** Anchor text per score, e.g. { "3": "Working solution, minimal tests" }. */
  anchors: z.record(z.string(), z.string().max(500)).optional(),
});

export const rubricSchema = z.object({
  scale: z.enum(["1-5", "1-10", "pass-fail"]),
  criteria: z.array(criterionSchema).max(20),
});
export type Rubric = z.infer<typeof rubricSchema>;

export const reviewerConfigSchema = z.object({
  pool: z.array(id).max(50),
  perSubmission: z.union([z.literal(1), z.literal(2)]),
  method: z.enum(["round_robin", "load", "manual"]),
  /** Scores within `cutoff ± band` (percent) automatically get a second reviewer. */
  borderline: z
    .object({ cutoff: z.number().min(0).max(100), band: z.number().min(0).max(50) })
    .optional(),
  blind: z.boolean(),
});

const formFieldSchema = z.object({
  id,
  label: z.string().min(1).max(200),
  kind: z.enum([
    "short_text",
    "long_text",
    "email",
    "phone",
    "number",
    "date",
    "url",
    "single_choice",
    "multi_choice",
    "file",
    "rating",
    "section",
  ]),
  required: z.boolean(),
  help: z.string().max(500).optional(),
  options: z.array(z.string().max(200)).max(50).optional(),
  /** For url fields: allowed hostnames, e.g. ["github.com"]. */
  allowedDomains: z.array(z.string().max(100)).max(10).optional(),
});
export type FormField = z.infer<typeof formFieldSchema>;

export const formConfigSchema = z.object({ fields: z.array(formFieldSchema).max(60) });

export const assessmentConfigSchema = z.object({
  durationMin: z.number().int().min(1).max(240),
  window: z
    .object({ opens: z.iso.datetime({ offset: true }), closes: z.iso.datetime({ offset: true }) })
    .optional(),
  questions: z.object({
    fixed: z.array(id).max(200),
    draw: z
      .array(
        z.object({
          tags: z.array(z.string()).min(1),
          difficulty: z.enum(["easy", "medium", "hard"]).optional(),
          count: z.number().int().min(1).max(100),
        }),
      )
      .max(10),
  }),
  shuffleQuestions: z.boolean(),
  shuffleOptions: z.boolean(),
  /** Percentage needed to pass the auto-graded part (used by rules). */
  passMark: z.number().min(0).max(100).optional(),
});

export const taskConfigSchema = z.object({
  brief: z.string().max(20_000),
  deliverables: z
    .array(
      z.object({
        id,
        kind: z.enum(["file", "link", "text"]),
        label: z.string().min(1).max(200),
        required: z.boolean(),
        allowedDomains: z.array(z.string().max(100)).max(10).optional(),
      }),
    )
    .max(10),
  allowResubmit: z.boolean(),
  /** A pool of problem statements; each candidate is shown a random `offer` of them and picks one. */
  problemStatements: z
    .object({
      offer: z.number().int().min(1).max(20),
      items: z
        .array(
          z.object({
            id,
            title: z.string().max(200),
            body: z.string().max(5000),
          }),
        )
        .max(50),
    })
    .optional(),
});

export const reviewGateConfigSchema = z.object({ instructions: z.string().max(5000).optional() });

export const customConfigSchema = z.object({
  fields: z.array(formFieldSchema).max(60),
  timerMin: z.number().int().min(1).max(240).optional(),
  reviewed: z.boolean(),
});

export const interviewConfigSchema = z.object({
  roundName: z.string().min(1).max(120),
  durationMin: z.union([z.literal(30), z.literal(45), z.literal(60)]),
  interviewerPool: z.array(id).max(30),
  mode: z.enum(["meet", "phone", "in_person"]),
  address: z.string().max(500).optional(),
  instructions: z.string().max(5000).optional(),
});

const nodeBase = {
  id,
  title: z.string().min(1).max(120),
  description: z.string().max(5000).optional(),
  visibility: z.enum(["candidate", "internal"]),
  deadline: deadlineSchema.optional(),
  graceHours: z.number().min(0).max(72).optional(),
  reviewers: reviewerConfigSchema.optional(),
  rubric: rubricSchema.optional(),
  emails: z
    .record(z.enum(["unlock", "reminder", "submitted", "advance", "reject"]), z.string().max(64))
    .optional(),
};

export const nodeSchema = z.discriminatedUnion("type", [
  z.object({ ...nodeBase, type: z.literal("form"), config: formConfigSchema }),
  z.object({ ...nodeBase, type: z.literal("assessment"), config: assessmentConfigSchema }),
  z.object({ ...nodeBase, type: z.literal("task"), config: taskConfigSchema }),
  z.object({ ...nodeBase, type: z.literal("review_gate"), config: reviewGateConfigSchema }),
  z.object({ ...nodeBase, type: z.literal("custom"), config: customConfigSchema }),
  z.object({ ...nodeBase, type: z.literal("interview"), config: interviewConfigSchema }),
]);
export type WorkflowNode = z.infer<typeof nodeSchema>;
export type NodeOf<T extends NodeType> = Extract<WorkflowNode, { type: T }>;

const op = z.enum([">=", "<=", ">", "<", "=="]);
export type ComparisonOp = z.infer<typeof op>;

export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { metric: "auto_score_pct" | "rubric_pct" | "composite"; op: ComparisonOp; value: number }
  | { criterion: string; op: ComparisonOp; value: number }
  | { answer: { fieldId: string; op: "eq" | "contains" | "in"; value: string | string[] } }
  | { rank: { by: "rubric_pct" | "composite"; top?: number; topPct?: number } }
  | { consensus: "all_yes" | "majority_yes" | "any_strong_no" }
  | { flag: "late" | "integrity_high" };

export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(conditionSchema).min(1) }),
    z.object({ any: z.array(conditionSchema).min(1) }),
    z.object({
      metric: z.enum(["auto_score_pct", "rubric_pct", "composite"]),
      op,
      value: z.number(),
    }),
    // Blank ids are allowed while a rule is being built; validateWorkflow flags them.
    z.object({ criterion: z.string().max(64), op, value: z.number() }),
    z.object({
      answer: z.object({
        fieldId: z.string().max(64),
        op: z.enum(["eq", "contains", "in"]),
        value: z.union([z.string(), z.array(z.string())]),
      }),
    }),
    z.object({
      rank: z.object({
        by: z.enum(["rubric_pct", "composite"]),
        top: z.number().int().min(1).optional(),
        topPct: z.number().min(1).max(100).optional(),
      }),
    }),
    z.object({ consensus: z.enum(["all_yes", "majority_yes", "any_strong_no"]) }),
    z.object({ flag: z.enum(["late", "integrity_high"]) }),
  ]),
);

export const edgeSchema = z.object({
  id,
  from: id,
  to: z.union([id, z.enum(TERMINALS)]),
  /** Lower runs first; the first matching edge wins. */
  priority: z.number().int(),
  when: z.union([z.object({ always: z.literal(true) }), conditionSchema]),
  /** Only honoured on edges to END_REJECT, and only when an admin opted in. */
  autoReject: z.boolean().optional(),
});
export type WorkflowEdge = z.infer<typeof edgeSchema>;

export const workflowConfigSchema = z.object({
  schemaVersion: z.literal(1),
  nodes: z.array(nodeSchema).max(40),
  edges: z.array(edgeSchema).max(120),
  scoring: z.object({ weights: z.record(id, z.number().min(0).max(100)) }),
  layout: z.record(z.string(), z.object({ x: z.number(), y: z.number() })),
});
export type WorkflowConfig = z.infer<typeof workflowConfigSchema>;

export const emptyWorkflow = (): WorkflowConfig => ({
  schemaVersion: 1,
  nodes: [],
  edges: [],
  scoring: { weights: {} },
  layout: {},
});

export function isTerminal(target: string): target is Terminal {
  return (TERMINALS as readonly string[]).includes(target);
}
