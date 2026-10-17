import { index, jsonb, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { id } from "./_shared";
import { users } from "./auth";

export const actorVia = pgEnum("actor_via", ["ui", "mcp", "rule", "system"]);

/** Append-only. Production grants the app's DB role INSERT/SELECT only on this table. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    // Set null if a candidate's account is purged; the entry itself stays.
    actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorVia: actorVia("actor_via").notNull(),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    ip: text("ip"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_entity_idx").on(t.entity, t.entityId),
    index("audit_log_at_idx").on(t.at),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    link: text("link"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notifications_user_unread_idx").on(t.userId, t.readAt)],
);
