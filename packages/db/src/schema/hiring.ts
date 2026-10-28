import {
  boolean,
  date,
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

export const roleStatus = pgEnum("role_status", ["active", "archived"]);

export const roles = pgTable("roles", {
  id: id(),
  title: text("title").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  seats: integer("seats"),
  stipend: text("stipend"),
  duration: text("duration"),
  location: text("location"),
  status: roleStatus("status").notNull().default("active"),
  ...timestamps,
});

export const cycleStatus = pgEnum("cycle_status", ["draft", "open", "closed", "archived"]);

export const cycles = pgTable(
  "cycles",
  {
    id: id(),
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id),
    name: text("name").notNull(),
    opensAt: timestamp("opens_at", { withTimezone: true }),
    closesAt: timestamp("closes_at", { withTimezone: true }),
    status: cycleStatus("status").notNull().default("draft"),
    retentionPurgeAt: timestamp("retention_purge_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("cycles_role_idx").on(t.roleId)],
);

/** A track: one selection process inside a cycle. */
export const workflows = pgTable(
  "workflows",
  {
    id: id(),
    cycleId: text("cycle_id")
      .notNull()
      .references(() => cycles.id),
    name: text("name").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    publishedVersionId: text("published_version_id"),
    branding: jsonb("branding").$type<Record<string, unknown>>().notNull().default({}),
    /**
     * Step id → ISO time: that step closes then for everyone, however late it opens (a final
     * extension). Steps that open later than the date are closed on arrival.
     */
    stepClosesBy: jsonb("step_closes_by").$type<Record<string, string>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [index("workflows_cycle_idx").on(t.cycleId)],
);

export const workflowVersionStatus = pgEnum("workflow_version_status", [
  "draft",
  "published",
  "superseded",
]);

/** The canvas graph lives in `config` (validated by core's workflow schema from M2). */
export const workflowVersions = pgTable(
  "workflow_versions",
  {
    id: id(),
    workflowId: text("workflow_id")
      .notNull()
      .references(() => workflows.id),
    version: integer("version").notNull(),
    status: workflowVersionStatus("status").notNull().default("draft"),
    config: jsonb("config").$type<Record<string, unknown>>().notNull(),
    changeSummary: text("change_summary"),
    createdBy: text("created_by").references(() => users.id),
    publishedBy: text("published_by").references(() => users.id),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [unique("workflow_versions_unique").on(t.workflowId, t.version)],
);

export const emailStatus = pgEnum("email_status", ["ok", "bounced", "complained"]);

export const candidates = pgTable("candidates", {
  id: id(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  phone: text("phone"),
  college: text("college"),
  gradYear: integer("grad_year"),
  linkedin: text("linkedin"),
  github: text("github"),
  portfolio: text("portfolio"),
  skills: text("skills").array().notNull().default([]),
  availableFrom: date("available_from"),
  availableTo: date("available_to"),
  preferredStart: date("preferred_start"),
  resumeFileId: text("resume_file_id"),
  custom: jsonb("custom").$type<Record<string, unknown>>().notNull().default({}),
  emailStatus: emailStatus("email_status").notNull().default("ok"),
  /** Privacy notice accepted in the portal (DPDP). Null until the candidate accepts. */
  consentAt: timestamp("consent_at", { withTimezone: true }),
  ...timestamps,
});

export const applicationStatus = pgEnum("application_status", [
  "active",
  "needs_decision",
  "on_hold",
  "interview_scheduled",
  "completed",
  "closed_rejected",
  "closed_withdrawn",
]);

export const applications = pgTable(
  "applications",
  {
    id: id(),
    candidateId: text("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id),
    workflowId: text("workflow_id")
      .notNull()
      .references(() => workflows.id),
    /** Pinned version: in-flight candidates never change process under their feet. */
    workflowVersionId: text("workflow_version_id").references(() => workflowVersions.id),
    currentNodeId: text("current_node_id"),
    status: applicationStatus("status").notNull().default("active"),
    compositeScore: numeric("composite_score", { precision: 6, scale: 2 }),
    invitedBy: text("invited_by").references(() => users.id),
    invitedAt: timestamp("invited_at", { withTimezone: true }).notNull().defaultNow(),
    testMode: boolean("test_mode").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    unique("applications_candidate_workflow_unique").on(t.candidateId, t.workflowId),
    index("applications_workflow_status_idx").on(t.workflowId, t.status),
    index("applications_candidate_idx").on(t.candidateId),
  ],
);
