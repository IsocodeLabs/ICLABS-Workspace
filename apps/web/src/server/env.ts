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
  /** Who gets an email when someone is shown an error in the workspace. */
  ERROR_ALERT_EMAIL: z.email().default("hr@isocodelabs.com"),
  // ─── Candidate files ───
  STORAGE_DRIVER: z.enum(["gcs", "local"]).default("local"),
  GCS_BUCKET: z.string().optional(),
  LOCAL_UPLOAD_DIR: z.string().default(".uploads"),
  /** "none" marks uploads clean immediately (local only); "clamav" waits for the scanner. */
  SCAN_MODE: z.enum(["none", "clamav"]).default("none"),
  // ─── Interviews (Google Calendar + Meet; see docs/TDD.md → Interviews) ───
  CALENDAR_DRIVER: z.enum(["google", "fake"]).default("fake"),
  /** Scheduling mailbox that organises every interview event (domain-wide delegation subject). */
  CALENDAR_ORGANIZER: z.string().default("hiring@isocodelabs.com"),
  CALENDAR_SA_EMAIL: z.string().optional(),
  /** The service account's private key (PEM), from Secret Manager. */
  CALENDAR_SA_KEY: z.string().optional(),
  // ─── AI review suggestions (Claude on Vertex AI; suggestions only, a human always decides) ───
  AI_REVIEW_ENABLED: z.stringbool().default(false),
  VERTEX_PROJECT_ID: z.string().optional(),
  /** "global" routes to any region with capacity; set a region to pin data residency. */
  VERTEX_REGION: z.string().default("global"),
  CLAUDE_MODEL: z.string().default("claude-opus-5-5"),
  /**
   * Team sign-in asks for a code emailed after the password. Turn off only while no real
   * email sender is configured (the code would never arrive); Google sign-in is unaffected.
   */
  TEAM_LOGIN_OTP: z.stringbool().default(true),
  // ─── careers.isocodelabs.com → workspace invites (see server/integrations/careers.ts) ───
  /** Shared HMAC secret with the careers site. Unset = the invite endpoint is off. */
  CAREERS_WEBHOOK_SECRET: z.string().min(32).optional(),
  /** Optional careers roleKey → workspace role slug, e.g. "software-engineering-intern=sde,…". */
  CAREERS_ROLE_MAP: z.string().optional(),
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
