import { jsonb, pgEnum, pgTable, text } from "drizzle-orm/pg-core";
import { id, timestamps } from "./_shared";
import { users } from "./auth";

export const templateKind = pgEnum("template_kind", [
  "workflow",
  "stage",
  "rubric",
  "email",
  "form",
]);

/** Saved building blocks: whole processes, single stages, rubrics, emails, forms. */
export const templates = pgTable("templates", {
  id: id(),
  kind: templateKind("kind").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  config: jsonb("config").$type<Record<string, unknown>>().notNull(),
  createdBy: text("created_by").references(() => users.id),
  ...timestamps,
});
