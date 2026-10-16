import nodemailer, { type SendMailOptions } from "nodemailer";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

export type OutgoingEmail = {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: { filename: string; content: string; contentType: string }[];
  /** SES message tags, echoed back in bounce/delivery events. */
  tags?: Record<string, string>;
};

export interface Mailer {
  send(email: OutgoingEmail): Promise<{ messageId: string }>;
}

export type MailerConfig = {
  transport: "ses" | "smtp" | "log";
  from: string;
  replyTo: string;
  awsRegion?: string;
  sesConfigurationSet?: string;
  smtpUrl?: string;
  /** Non-production safety net: anyone not on this list is redirected to the SES simulator. */
  allowlist?: string[];
};

const SIMULATOR = "success@simulator.amazonses.com";

export function redirectRecipient(to: string, allowlist?: string[]): string {
  if (!allowlist || allowlist.length === 0) return to;
  const email = to.toLowerCase();
  const allowed = allowlist.some((entry) =>
    entry.startsWith("@") ? email.endsWith(entry.toLowerCase()) : email === entry.toLowerCase(),
  );
  return allowed ? to : SIMULATOR;
}

export function createMailer(config: MailerConfig): Mailer {
  if (config.transport === "log") {
    return {
      async send(email) {
        // Never log bodies: they can contain temporary passwords.
        console.info(`[email] (log transport) to=${email.to} subject="${email.subject}"`);
        return { messageId: `log-${Date.now()}` };
      },
    };
  }

  const transporter =
    config.transport === "ses"
      ? nodemailer.createTransport({
          SES: {
            sesClient: new SESv2Client({ region: config.awsRegion ?? "ap-south-1" }),
            SendEmailCommand,
          },
        })
      : nodemailer.createTransport(config.smtpUrl ?? "smtp://localhost:1025");

  return {
    async send(email) {
      const info = await transporter.sendMail({
        from: config.from,
        replyTo: config.replyTo,
        to: redirectRecipient(email.to, config.allowlist),
        subject: email.subject,
        text: email.text,
        html: email.html,
        attachments: email.attachments,
        ...(config.transport === "ses"
          ? {
              ses: {
                ConfigurationSetName: config.sesConfigurationSet,
                EmailTags: Object.entries(email.tags ?? {}).map(([Name, Value]) => ({
                  Name,
                  Value,
                })),
              },
            }
          : {}),
      } as SendMailOptions);
      return { messageId: String(info.messageId ?? "") };
    },
  };
}
