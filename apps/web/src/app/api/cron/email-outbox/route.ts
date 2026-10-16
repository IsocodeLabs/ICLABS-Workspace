import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { isCronRequest } from "@/server/cron";
import { mailer, outboxConfig } from "@/server/email";
import { processOutbox } from "@/server/email/outbox";

/** Every minute (Cloud Scheduler): send whatever is due in the outbox. */
export async function POST(req: Request) {
  if (!isCronRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const result = await processOutbox(db(), mailer(), outboxConfig(), { limit: 200 });
  return NextResponse.json(result);
}
