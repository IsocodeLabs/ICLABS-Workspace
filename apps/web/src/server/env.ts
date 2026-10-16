import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  /** Connection pool size. Use 1 with the in-memory pglite-server (single session). */
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  BETTER_AUTH_URL: z.url(),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  TEAM_EMAIL_DOMAIN: z.string().default("isocodelabs.com"),
  // ─── Email (Amazon SES in production; see docs/amazon-ses-setup.md) ───
  EMAIL_TRANSPORT: z.enum(["ses", "smtp", "log"]).default("log"),
  EMAIL_FROM: z.string().default("Isocode Hiring <hiring@mail.isocodelabs.com>"),
  EMAIL_REPLY_TO: z.string().default("hiring@isocodelabs.com"),
  AWS_REGION: z.string().default("ap-south-1"),
  SES_CONFIGURATION_SET: z.string().default("workspace-transactional"),
  SMTP_URL: z.string().optional(),
  /** Non-production: comma list of addresses or @domains that may receive real email. */
  EMAIL_ALLOWLIST: z.string().optional(),
  /** 32 random bytes, base64. Encrypts one-time secrets while they wait in the outbox. */
  EMAIL_PAYLOAD_KEY: z.string().min(40, "EMAIL_PAYLOAD_KEY must be 32 bytes, base64"),
  SNS_TOPIC_ARN: z.string().optional(),
  /** Shared secret Cloud Scheduler sends to /api/cron/* (Authorization: Bearer …). */
  CRON_SECRET: z.string().min(32),
  /** Local only: lets /api/dev/team-login sign in an allow-listed team email without Google. */
  DEV_TEAM_LOGIN: z.stringbool().default(false),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Validated on first use so `next build` doesn't need runtime secrets. */
export function env(): Env {
  cached ??= schema.parse(process.env);
  return cached;
}

/** True only on a developer machine that explicitly opted in. Never in production. */
export function devTeamLoginEnabled(): boolean {
  const e = env();
  return e.NODE_ENV === "development" && e.DEV_TEAM_LOGIN;
}
