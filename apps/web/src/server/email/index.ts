import "server-only";
import { after } from "next/server";
import { db } from "../db";
import { env } from "../env";
import { createMailer, type Mailer } from "./mailer";
import { enqueueEmail, processOutbox, type EnqueueInput } from "./outbox";

let mailerInstance: Mailer | undefined;

export function mailer(): Mailer {
  if (!mailerInstance) {
    const e = env();
    mailerInstance = createMailer({
      transport: e.EMAIL_TRANSPORT,
      from: e.EMAIL_FROM,
      replyTo: e.EMAIL_REPLY_TO,
      awsRegion: e.AWS_REGION,
      sesConfigurationSet: e.SES_CONFIGURATION_SET,
      smtpUrl: e.SMTP_URL,
      allowlist:
        e.NODE_ENV === "production"
          ? undefined
          : e.EMAIL_ALLOWLIST?.split(",")
              .map((s) => s.trim())
              .filter(Boolean),
    });
  }
  return mailerInstance;
}

export const outboxConfig = () => ({ secretKey: env().EMAIL_PAYLOAD_KEY });

export function appUrl(path = "/"): string {
  return new URL(path, env().BETTER_AUTH_URL).toString();
}

/**
 * Queues an email and kicks the dispatcher once the response has gone out. Cloud Scheduler
 * also runs the dispatcher every minute, so a crash here never loses an email.
 */
export async function queueEmail(input: EnqueueInput): Promise<string> {
  const id = await enqueueEmail(db(), outboxConfig(), input);
  after(async () => {
    try {
      await processOutbox(db(), mailer(), outboxConfig(), { limit: 20 });
    } catch (e) {
      console.error("[email] dispatch failed", (e as Error).message);
    }
  });
  return id;
}
