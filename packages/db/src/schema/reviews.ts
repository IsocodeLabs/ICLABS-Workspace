import {
  boolean,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { id } from "./_shared";
import { users } from "./auth";
import { applications } from "./hiring";
import { stageProgress } from "./stages";
import { teamMembers } from "./team";

export const assignmentReason = pgEnum("assignment_reason", [
  "primary",
  "borderline_second",
  "manual",
]);
export const assignmentStatus = pgEnum("assignment_status", ["assigned", "submitted", "released"]);

export const reviewAssignments = pgTable(
  "review_assignments",
  {
    id: id(),
    stageProgressId: text("stage_progress_id")
      .notNull()
      .references(() => stageProgress.id, { onDelete: "cascade" }),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    nodeId: text("node_id").notNull(),
    reviewerId: text("reviewer_id")
      .notNull()
      .references(() => teamMembers.id),
    reason: assignmentReason("reason").notNull().default("primary"),
    status: assignmentStatus("status").notNull().default("assigned"),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("review_assignments_reviewer_idx").on(t.reviewerId, t.status),
    index("review_assignments_progress_idx").on(t.stageProgressId),
  ],
);

export const recommendation = pgEnum("recommendation", ["strong_yes", "yes", "no", "strong_no"]);
export const reviewKind = pgEnum("review_kind", ["human", "ai_suggestion"]);

export const reviews = pgTable(
  "reviews",
  {
    id: id(),
    stageProgressId: text("stage_progress_id")
      .notNull()
      .references(() => stageProgress.id, { onDelete: "cascade" }),
    assignmentId: text("assignment_id").references(() => reviewAssignments.id, {
      onDelete: "set null",
    }),
    reviewerId: text("reviewer_id").references(() => teamMembers.id),
    kind: reviewKind("kind").notNull(),
    scores: jsonb("scores").$type<Record<string, number>>().notNull(),
    totalPct: numeric("total_pct", { precision: 6, scale: 2, mode: "number" }),
    recommendation: recommendation("recommendation"),
    notes: text("notes"),
    /** AI suggestions: per-criterion evidence quotes and missing deliverables. */
    evidence: jsonb("evidence").$type<Record<string, string>>(),
    acceptedFromAi: boolean("accepted_from_ai").notNull().default(false),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("reviews_progress_idx").on(t.stageProgressId)],
);

export const decisionAction = pgEnum("decision_action", [
  "advance",
  "reject",
  "hold",
  "reopen",
  "complete",
]);

/** Every human or rule decision about an application, for the audit trail and pipeline. */
export const decisions = pgTable(
  "decisions",
  {
    id: id(),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    fromNodeId: text("from_node_id"),
    action: decisionAction("action").notNull(),
    targetNodeId: text("target_node_id"),
    byUserId: text("by_user_id").references(() => users.id),
    via: text("via").notNull().default("ui"),
    note: text("note"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("decisions_application_idx").on(t.applicationId)],
);
