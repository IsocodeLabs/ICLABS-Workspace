import { text, timestamp } from "drizzle-orm/pg-core";
import { ulid } from "ulid";

/** Non-guessable, time-sortable primary key. */
export const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => ulid());

export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};
