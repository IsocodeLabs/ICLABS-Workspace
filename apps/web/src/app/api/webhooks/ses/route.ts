import { NextResponse } from "next/server";
import { eq, teamMembers, notifications, users, candidates } from "@iclabs/db";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { applyDeliveryEvent } from "@/server/email/outbox";
import { isAwsSnsUrl, parseSesEvent, verifySnsMessage, type SnsMessage } from "@/server/email/sns";

/** Amazon SNS → SES delivery, bounce and complaint events. Signature-verified. */
export async function POST(req: Request) {
  const topicArn = env().SNS_TOPIC_ARN;
  if (!topicArn) return NextResponse.json({ error: "not configured" }, { status: 404 });

  let message: SnsMessage;
  try {
    message = JSON.parse(await req.text()) as SnsMessage;
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  if (!(await verifySnsMessage(message, { topicArn }))) {
    return NextResponse.json({ error: "invalid signature" }, { status: 403 });
  }

  if (message.Type === "SubscriptionConfirmation") {
    if (!isAwsSnsUrl(message.SubscribeURL))
      return NextResponse.json({ error: "bad url" }, { status: 400 });
    await fetch(message.SubscribeURL!, { signal: AbortSignal.timeout(5000) });
    return NextResponse.json({ ok: true });
  }
  if (message.Type !== "Notification") return NextResponse.json({ ok: true });

  const event = parseSesEvent(message.Message);
  if (!event) return NextResponse.json({ ok: true });
  const applied = await applyDeliveryEvent(db(), event);

  // Tell admins in-app when a candidate's address stops working.
  if (
    applied?.userId &&
    (event.type === "complaint" || (event.type === "bounce" && event.permanent))
  ) {
    const [who] = await db()
      .select({ email: users.email, name: candidates.name })
      .from(users)
      .leftJoin(candidates, eq(candidates.userId, users.id))
      .where(eq(users.id, applied.userId));
    const admins = await db()
      .select({ userId: teamMembers.userId })
      .from(teamMembers)
      .where(eq(teamMembers.role, "admin"));
    const rows = admins
      .filter((a) => a.userId)
      .map((a) => ({
        userId: a.userId!,
        kind: "email_problem",
        title: `Email to ${who?.email ?? "a candidate"} ${event.type === "complaint" ? "was marked as spam" : "bounced"}`,
        body: "Check the address on their profile. Further emails to it are paused.",
        link: `/team/candidates?q=${encodeURIComponent(who?.email ?? "")}`,
      }));
    if (rows.length) await db().insert(notifications).values(rows);
  }
  return NextResponse.json({ ok: true });
}
