import { index, integer, jsonb, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { id, timestamps } from "./_shared";
import { users } from "./auth";
import { applications } from "./hiring";

export const emailMessageStatus = pgEnum("email_message_status", [
  "queued",
  "sending",
  "sent",
  "delivered",
  "bounced",
  "complained",
  "rejected",
  "failed",
  "suppressed",
]);

/**
 * Outbox: every candidate/team email is a row here first, then sent by the dispatcher.
 * The rendered body is never stored. One-time secrets (temporary password, reset link)
 * live encrypted in `secretPayload` and are wiped as soon as the email is sent.
 */
export const emailMessages = pgTable(
  "email_messages",
  {
    id: id(),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    applicationId: text("application_id").references(() => applications.id, {
      onDelete: "set null",
    }),
    toEmail: text("to_email").notNull(),
    templateKey: text("template_key").notNull(),
    subject: text("subject"),
    vars: jsonb("vars").$type<Record<string, string>>().notNull().default({}),
    secretPayload: text("secret_payload"),
    status: emailMessageStatus("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    sendAfter: timestamp("send_after", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    providerMessageId: text("provider_message_id"),
    events: jsonb("events")
      .$type<{ type: string; at: string; detail?: string }[]>()
      .notNull()
      .default([]),
    ...timestamps,
  },
  (t) => [
    index("email_messages_due_idx").on(t.status, t.sendAfter),
    index("email_messages_provider_idx").on(t.providerMessageId),
    index("email_messages_user_idx").on(t.userId),
  ],
);

/** Admin-edited wording. Missing keys fall back to the defaults in code. */
export const emailTemplates = pgTable("email_templates", {
  key: text("key").primaryKey(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  updatedBy: text("updated_by").references(() => users.id),
  ...timestamps,
});
