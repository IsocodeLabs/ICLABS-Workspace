import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  BETTER_AUTH_URL: z.url(),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  TEAM_EMAIL_DOMAIN: z.string().default("isocodelabs.com"),
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
