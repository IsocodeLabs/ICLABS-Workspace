"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { requireTeam } from "@/server/auth/session";
import { ForbiddenError } from "@/server/audit";
import {
  cancelInterview,
  checkAvailability,
  recordInterviewOutcome,
  rescheduleInterview,
  scheduleInterview,
} from "@/server/interviews";
import { interviewDeps } from "@/server/interviews/deps";

export type InterviewActionResult = { ok: true } | { ok: false; error: string; conflicts?: string[] };

const slot = z.object({
  startsAt: z.iso.datetime({ offset: true }),
  interviewerIds: z.array(z.string().min(1)).min(1).max(10),
  force: z.boolean().optional(),
});

async function run(fn: () => Promise<InterviewActionResult>): Promise<InterviewActionResult> {
  try {
    const res = await fn();
    revalidatePath("/team/interviews");
    return res.ok ? { ok: true } : res;
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: "You don't have access to that." };
    console.error("[interviews]", err instanceof Error ? err.message : err);
    return { ok: false, error: "Google Calendar didn't respond. Try again in a minute." };
  }
}

export async function scheduleAction(applicationId: string, input: z.input<typeof slot>) {
  const { actor } = await requireTeam(["admin", "hiring_manager"]);
  const parsed = slot.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Pick a time and at least one interviewer." };
  return run(() =>
    scheduleInterview(db(), interviewDeps(), actor, applicationId, { ...parsed.data, startsAt: new Date(parsed.data.startsAt) }),
  );
}

export async function rescheduleAction(interviewId: string, input: z.input<typeof slot>) {
  const { actor } = await requireTeam(["admin", "hiring_manager"]);
  const parsed = slot.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Pick a time and at least one interviewer." };
  return run(() =>
    rescheduleInterview(db(), interviewDeps(), actor, interviewId, { ...parsed.data, startsAt: new Date(parsed.data.startsAt) }),
  );
}

export async function cancelAction(interviewId: string) {
  const { actor } = await requireTeam(["admin", "hiring_manager"]);
  return run(() => cancelInterview(db(), interviewDeps(), actor, interviewId));
}

export async function outcomeAction(interviewId: string, outcome: "done" | "no_show") {
  const { actor } = await requireTeam(["admin", "hiring_manager"]);
  return run(() => recordInterviewOutcome(db(), interviewDeps(), actor, interviewId, outcome));
}

export async function availabilityAction(input: {
  interviewerIds: string[];
  startsAt: string;
  durationMin: number;
  exceptInterviewId?: string;
}): Promise<{ busy: string[] } | { error: string }> {
  await requireTeam(["admin", "hiring_manager"]);
  const startsAt = new Date(input.startsAt);
  if (Number.isNaN(startsAt.getTime()) || input.interviewerIds.length === 0) return { busy: [] };
  try {
    return {
      busy: await checkAvailability(db(), interviewDeps(), {
        interviewerIds: input.interviewerIds.slice(0, 10),
        startsAt,
        durationMin: Math.min(Math.max(input.durationMin, 15), 120),
        exceptInterviewId: input.exceptInterviewId,
      }),
    };
  } catch {
    return { error: "Couldn't check calendars right now." };
  }
}
