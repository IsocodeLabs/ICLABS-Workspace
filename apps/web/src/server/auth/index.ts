import "server-only";
import { nextCookies } from "better-auth/next-js";
import { db } from "../db";
import { env } from "../env";
import { createAuth, type Auth } from "./create-auth";
import type { AuthNotifier } from "./candidate-auth";

/**
 * Until Amazon SES is wired in (M3), notifications are logged as events only.
 * Never log reset URLs, tokens or passwords.
 */
export const notifier: AuthNotifier = {
  accountLocked: async () => console.info("[auth] account locked notification queued"),
  passwordChanged: async () => console.info("[auth] password changed notification queued"),
};

let instance: Auth | undefined;

export function auth(): Auth {
  if (!instance) {
    const e = env();
    instance = createAuth({
      db: db(),
      secret: e.BETTER_AUTH_SECRET,
      baseURL: e.BETTER_AUTH_URL,
      teamDomain: e.TEAM_EMAIL_DOMAIN,
      google: { clientId: e.GOOGLE_CLIENT_ID, clientSecret: e.GOOGLE_CLIENT_SECRET },
      sendResetPassword: async ({ url }) => {
        if (e.NODE_ENV === "development") console.info(`[auth] dev reset link: ${url}`);
        else console.warn("[auth] password reset requested; email delivery arrives in M3");
      },
      plugins: [nextCookies()],
    });
  }
  return instance;
}
