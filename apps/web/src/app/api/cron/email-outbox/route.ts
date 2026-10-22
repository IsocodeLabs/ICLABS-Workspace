import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { isCronRequest } from "@/server/cron";
import { mailer, outboxConfig } from "@/server/email";
import { processOutbox } from "@/server/email/outbox";

/**
 * Every minute (Cloud Scheduler): send whatever is due in the outbox. Up to 600 a minute, six at
 * a time (~10/s, under SES's default 14/s production quota), so 3,000 invites go out in ~5 minutes.
 */
export async function POST(req: Request) {
  if (!isCronRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const result = await processOutbox(db(), mailer(), outboxConfig(), {
    limit: 600,
    concurrency: 6,
  });
  return NextResponse.json(result);
}
