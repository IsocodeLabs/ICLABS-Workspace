import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { isCronRequest } from "@/server/cron";
import { sweepExpiredAssessments } from "@/server/stages/candidate";
import { progressionDeps } from "@/server/stages/deps";
import { sendDeadlineReminders, sweepMissedDeadlines } from "@/server/stages/progression";
import { sendInterviewReminders } from "@/server/interviews";
import { interviewDeps } from "@/server/interviews/deps";

/** Every minute (Cloud Scheduler): auto-submit timed-out attempts, deadlines, reminders, interview reminders. */
export async function POST(req: Request) {
  if (!isCronRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const deps = progressionDeps();
  const autoSubmitted = await sweepExpiredAssessments(db(), deps);
  const missed = await sweepMissedDeadlines(db(), deps);
  const reminded = await sendDeadlineReminders(db(), deps);
  const interviewReminders = await sendInterviewReminders(db(), interviewDeps());
  return NextResponse.json({ autoSubmitted, missed, reminded, interviewReminders });
}
