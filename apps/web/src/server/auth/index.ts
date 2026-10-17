import "server-only";
import { nextCookies } from "better-auth/next-js";
import { testUtils } from "better-auth/plugins";
import { eq, candidates, users } from "@iclabs/db";
import { db } from "../db";
import { devTeamLoginEnabled, env } from "../env";
import { appUrl, queueEmail } from "../email";
import { createAuth, type Auth } from "./create-auth";
import type { AuthNotifier } from "./candidate-auth";
import { teamOtpPlugin } from "./team-otp-plugin";

async function recipient(email: string) {
  const [row] = await db()
    .select({ userId: users.id, name: candidates.name, fallback: users.name })
    .from(users)
    .leftJoin(candidates, eq(candidates.userId, users.id))
    .where(eq(users.email, email.toLowerCase()));
  return row ? { userId: row.userId, firstName: (row.name ?? row.fallback).split(" ")[0]! } : null;
}

/** Security emails go through the outbox like everything else. */
export const notifier: AuthNotifier = {
  accountLocked: async (email) => {
    const r = await recipient(email);
    await queueEmail({
      to: email,
      templateKey: "account_locked",
      userId: r?.userId,
      vars: { first_name: r?.firstName ?? "there" },
    });
  },
  passwordChanged: async (email) => {
    const r = await recipient(email);
    await queueEmail({
      to: email,
      templateKey: "password_changed",
      userId: r?.userId,
      vars: { first_name: r?.firstName ?? "there" },
    });
  },
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
      // The reset link is a secret: it travels encrypted in the outbox and is wiped after sending.
      sendResetPassword: async ({ email, url }) => {
        const r = await recipient(email);
        await queueEmail({
          to: email,
          templateKey: "password_reset",
          userId: r?.userId,
          vars: { first_name: r?.firstName ?? "there" },
          secrets: { reset_url: url },
        });
      },
      // nextCookies stays last so cookies set by other plugins reach the browser.
      plugins: [teamOtpPlugin(db()), ...(devTeamLoginEnabled() ? [testUtils()] : []), nextCookies()],
    });
  }
  return instance;
}

export { appUrl };
