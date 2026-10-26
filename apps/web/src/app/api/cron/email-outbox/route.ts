import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { isCronRequest } from "@/server/cron";
import { mailer, outboxConfig } from "@/server/email";
import { processOutbox } from "@/server/email/outbox";
import { restartDeadlinesFromLogin } from "@/server/stages/progression";

/** Emails that carry (or announce) a workspace login: the candidate can only start after these. */
const LOGIN_EMAILS = new Set(["welcome", "role_added"]);

/**
 * Every minute (Cloud Scheduler): send whatever is due in the outbox. Up to 600 a minute, six at
 * a time (~10/s, under SES's default 14/s production quota), so 3,000 invites go out in ~5 minutes.
 */
export async function POST(req: Request) {
  if (!isCronRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const result = await processOutbox(db(), mailer(), outboxConfig(), {
    limit: 600,
    concurrency: 6,
    // A scheduled or resent login email restarts the clock on steps they couldn't start yet.
    onSent: async ({ templateKey, userId, sentAt }) => {
      if (userId && LOGIN_EMAILS.has(templateKey))
        await restartDeadlinesFromLogin(db(), userId, sentAt);
    },
  });
  return NextResponse.json(result);
}
