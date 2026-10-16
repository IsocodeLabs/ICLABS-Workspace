import { boolean, index, pgEnum, pgTable, text, unique } from "drizzle-orm/pg-core";
import { id, timestamps } from "./_shared";
import { users } from "./auth";

export const teamRole = pgEnum("team_role", ["admin", "hiring_manager", "reviewer", "interviewer"]);

/**
 * The team allow-list. A Google sign-in only succeeds for an active row whose email matches;
 * `userId` is filled in on first sign-in.
 */
export const teamMembers = pgTable("team_members", {
  id: id(),
  email: text("email").notNull().unique(),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  role: teamRole("role").notNull(),
  active: boolean("active").notNull().default(true),
  ...timestamps,
});

export const assignmentScope = pgEnum("assignment_scope", ["role", "workflow"]);

/** Which roles or tracks a hiring manager (or reviewer pool) covers. */
export const roleAssignments = pgTable(
  "role_assignments",
  {
    id: id(),
    teamMemberId: text("team_member_id")
      .notNull()
      .references(() => teamMembers.id, { onDelete: "cascade" }),
    scope: assignmentScope("scope").notNull(),
    scopeId: text("scope_id").notNull(),
    ...timestamps,
  },
  (t) => [
    unique("role_assignments_unique").on(t.teamMemberId, t.scope, t.scopeId),
    index("role_assignments_member_idx").on(t.teamMemberId),
  ],
);
