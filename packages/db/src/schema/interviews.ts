import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { id, timestamps } from "./_shared";
import { users } from "./auth";
import { applications } from "./hiring";
import { stageProgress } from "./stages";

export const interviewStatus = pgEnum("interview_status", ["scheduled", "cancelled", "done", "no_show"]);
export const interviewMode = pgEnum("interview_mode", ["meet", "phone", "in_person"]);

/** One booked interview. Rescheduling updates the row and the same calendar event. */
export const interviews = pgTable(
  "interviews",
  {
    id: id(),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    stageProgressId: text("stage_progress_id")
      .notNull()
      .references(() => stageProgress.id, { onDelete: "cascade" }),
    nodeId: text("node_id").notNull(),
    roundName: text("round_name").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    /** Team member ids on the panel. */
    interviewerIds: text("interviewer_ids").array().notNull(),
    mode: interviewMode("mode").notNull(),
    location: text("location"),
    meetUrl: text("meet_url"),
    calendarEventId: text("calendar_event_id"),
    status: interviewStatus("status").notNull().default("scheduled"),
    rescheduleCount: integer("reschedule_count").notNull().default(0),
    reminderDaySentAt: timestamp("reminder_day_sent_at", { withTimezone: true }),
    reminderHourSentAt: timestamp("reminder_hour_sent_at", { withTimezone: true }),
    createdBy: text("created_by").references(() => users.id),
    ...timestamps,
  },
  (t) => [
    index("interviews_starts_idx").on(t.status, t.startsAt),
    // At most one live interview per stage.
    uniqueIndex("interviews_one_live").on(t.stageProgressId).where(sql`status = 'scheduled'`),
  ],
);

// ─── Admin MCP server: OAuth 2.1 clients and tokens ──────────────────────────

/** Dynamically registered MCP clients (Claude Desktop, claude.ai, Claude Code). */
export const oauthClients = pgTable("oauth_clients", {
  id: id(),
  clientId: text("client_id").notNull().unique(),
  name: text("name").notNull(),
  redirectUris: text("redirect_uris").array().notNull(),
  ...timestamps,
});

/** Short-lived authorization codes (PKCE S256 required). Stored hashed. */
export const oauthCodes = pgTable("oauth_codes", {
  id: id(),
  codeHash: text("code_hash").notNull().unique(),
  clientId: text("client_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  scope: text("scope").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

/** A connected Claude client: access + refresh token pair, hashed. Revoking deletes the row. */
export const oauthGrants = pgTable(
  "oauth_grants",
  {
    id: id(),
    clientId: text("client_id").notNull(),
    clientName: text("client_name").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessTokenHash: text("access_token_hash").notNull().unique(),
    accessExpiresAt: timestamp("access_expires_at", { withTimezone: true }).notNull(),
    refreshTokenHash: text("refresh_token_hash").notNull().unique(),
    refreshExpiresAt: timestamp("refresh_expires_at", { withTimezone: true }).notNull(),
    scope: text("scope").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("oauth_grants_user_idx").on(t.userId)],
);

/** Workspace-wide switches (e.g. the MCP kill switch). */
export const workspaceSettings = pgTable("workspace_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: text("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
