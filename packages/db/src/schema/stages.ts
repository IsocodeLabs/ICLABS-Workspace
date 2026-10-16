import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { id, timestamps } from "./_shared";
import { users } from "./auth";
import { applications, candidates } from "./hiring";

// ─── Question bank ───────────────────────────────────────────────────────────

export const questionType = pgEnum("question_type", ["mcq", "multi", "short", "long"]);
export const difficulty = pgEnum("difficulty", ["easy", "medium", "hard"]);
export const questionStatus = pgEnum("question_status", ["draft", "approved", "archived"]);
export const contentSource = pgEnum("content_source", ["human", "claude"]);

export const questions = pgTable(
  "questions",
  {
    id: id(),
    type: questionType("type").notNull(),
    body: text("body").notNull(),
    options: jsonb("options").$type<{ id: string; text: string }[]>().notNull().default([]),
    /** Correct option ids. Never sent to candidates. */
    correct: text("correct").array().notNull().default([]),
    /** Guidance for reviewers on written answers. */
    explanation: text("explanation"),
    tags: text("tags").array().notNull().default([]),
    difficulty: difficulty("difficulty").notNull().default("medium"),
    points: integer("points").notNull().default(1),
    status: questionStatus("status").notNull().default("draft"),
    source: contentSource("source").notNull().default("human"),
    createdBy: text("created_by").references(() => users.id),
    approvedBy: text("approved_by").references(() => users.id),
    ...timestamps,
  },
  (t) => [index("questions_status_idx").on(t.status)],
);

// ─── Candidate progress through stages ───────────────────────────────────────

export const stageState = pgEnum("stage_state", [
  "unlocked",
  "in_progress",
  "submitted",
  "reviewed",
  "passed",
  "failed",
  "missed",
  "skipped",
]);

/** One row per application per stage the candidate has reached. */
export const stageProgress = pgTable(
  "stage_progress",
  {
    id: id(),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    nodeId: text("node_id").notNull(),
    state: stageState("state").notNull().default("unlocked"),
    unlockedAt: timestamp("unlocked_at", { withTimezone: true }).notNull().defaultNow(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    graceUntil: timestamp("grace_until", { withTimezone: true }),
    /** Admin-granted extension; replaces dueAt + grace when set. */
    extendedUntil: timestamp("extended_until", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    autoScorePct: numeric("auto_score_pct", { precision: 6, scale: 2, mode: "number" }),
    /** Unsaved work for forms and tasks (autosave). */
    draft: jsonb("draft").$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (t) => [
    unique("stage_progress_unique").on(t.applicationId, t.nodeId),
    index("stage_progress_due_idx").on(t.state, t.dueAt),
  ],
);

/** A timed assessment attempt. The server's endsAt is the only clock that counts. */
export const assessmentSessions = pgTable("assessment_sessions", {
  id: id(),
  stageProgressId: text("stage_progress_id")
    .notNull()
    .unique()
    .references(() => stageProgress.id, { onDelete: "cascade" }),
  questionIds: text("question_ids").array().notNull(),
  answers: jsonb("answers").$type<Record<string, string[] | string>>().notNull().default({}),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  autoSubmitted: boolean("auto_submitted").notNull().default(false),
});

export const submissions = pgTable(
  "submissions",
  {
    id: id(),
    stageProgressId: text("stage_progress_id")
      .notNull()
      .references(() => stageProgress.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    fileIds: text("file_ids").array().notNull().default([]),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    isLate: boolean("is_late").notNull().default(false),
    lateByMinutes: integer("late_by_minutes"),
  },
  (t) => [unique("submissions_version_unique").on(t.stageProgressId, t.version)],
);

export const scanStatus = pgEnum("scan_status", ["pending", "clean", "infected", "error"]);

export const files = pgTable(
  "files",
  {
    id: id(),
    ownerCandidateId: text("owner_candidate_id").references(() => candidates.id, {
      onDelete: "cascade",
    }),
    objectKey: text("object_key").notNull().unique(),
    filename: text("filename").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    scanStatus: scanStatus("scan_status").notNull().default("pending"),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("files_owner_idx").on(t.ownerCandidateId)],
);

export const integrityEventType = pgEnum("integrity_event_type", [
  "blur",
  "visibility_hidden",
  "fullscreen_exit",
  "paste_attempt",
  "copy_attempt",
]);

export const integrityEvents = pgTable(
  "integrity_events",
  {
    id: id(),
    sessionId: text("session_id")
      .notNull()
      .references(() => assessmentSessions.id, { onDelete: "cascade" }),
    type: integrityEventType("type").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
    durationMs: integer("duration_ms"),
  },
  (t) => [index("integrity_session_idx").on(t.sessionId)],
);
