import type { WorkflowNode } from "../workflow/schema";

/** India Standard Time has no daylight saving, so a fixed offset is exact. */
const IST_OFFSET_MS = 330 * 60 * 1000;

/** When a stage is due and when its grace window ends, for a stage unlocked at `unlockedAt`. */
export function computeDeadlines(
  node: WorkflowNode,
  unlockedAt: Date,
): { dueAt: Date | null; graceUntil: Date | null } {
  const d = node.deadline;
  if (!d) return { dueAt: null, graceUntil: null };
  let dueAt: Date;
  if (d.mode === "absolute") {
    dueAt = new Date(d.at);
  } else {
    const ist = new Date(unlockedAt.getTime() + IST_OFFSET_MS);
    const [h, m] = (d.atTime ?? "23:59").split(":").map(Number) as [number, number];
    const localMidnightUtcMs = Date.UTC(
      ist.getUTCFullYear(),
      ist.getUTCMonth(),
      ist.getUTCDate() + d.daysAfterUnlock,
      h,
      m,
    );
    dueAt = new Date(localMidnightUtcMs - IST_OFFSET_MS);
  }
  const grace = node.graceHours ?? 0;
  return { dueAt, graceUntil: new Date(dueAt.getTime() + grace * 3600_000) };
}

export function formatIst(date: Date): string {
  return (
    date.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      dateStyle: "medium",
      timeStyle: "short",
    }) + " IST"
  );
}
