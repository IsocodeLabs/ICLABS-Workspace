import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { ulid } from "ulid";
import { eq, accounts, sessions, users, verifications, type Db } from "@iclabs/db";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@iclabs/core";
import { hashPassword, verifyPassword } from "./password-hash";
import { allowSession, allowTeamSignUp } from "./team-access";

export type AuthConfig = {
  db: Db;
  secret: string;
  baseURL: string;
  teamDomain: string;
  google?: { clientId: string; clientSecret: string };
  /** Delivers the reset link. Wired to Amazon SES in M3. */
  sendResetPassword: (data: { email: string; url: string }) => Promise<void>;
  plugins?: BetterAuthPlugin[];
};

const DAY = 60 * 60 * 24;

/**
 * Better Auth handles sessions, Google sign-in for the team, and password resets.
 * Candidate password sign-in and password changes go through `candidate-auth.ts`, which adds
 * lockout, rate limits and the forced first-login change on top.
 */
export function createAuth(config: AuthConfig) {
  const { db } = config;
  return betterAuth({
    secret: config.secret,
    baseURL: config.baseURL,
    database: drizzleAdapter(db, {
      provider: "pg",
      usePlural: true,
      schema: { users, sessions, accounts, verifications },
    }),
    advanced: { database: { generateId: () => ulid() } },
    user: {
      additionalFields: {
        kind: { type: "string", input: false, defaultValue: "candidate" },
        status: { type: "string", input: false, defaultValue: "active" },
        mustChangePassword: { type: "boolean", input: false, defaultValue: false },
        tempPasswordExpiresAt: { type: "date", input: false, required: false, returned: false },
        passwordChangedAt: { type: "date", input: false, required: false, returned: false },
        failedLoginCount: { type: "number", input: false, defaultValue: 0, returned: false },
        lockedUntil: { type: "date", input: false, required: false, returned: false },
      },
    },
    session: {
      // 7-day sliding idle timeout.
      expiresIn: 7 * DAY,
      updateAge: DAY,
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      autoSignIn: false,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
      password: {
        hash: hashPassword,
        verify: ({ hash, password }) => verifyPassword(hash, password),
      },
      resetPasswordTokenExpiresIn: 30 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: ({ user, url }) => config.sendResetPassword({ email: user.email, url }),
      // A candidate who resets by email has chosen their own password: lift the first-login gate.
      onPasswordReset: async ({ user }) => {
        await db
          .update(users)
          .set({
            mustChangePassword: false,
            tempPasswordExpiresAt: null,
            passwordChangedAt: new Date(),
            failedLoginCount: 0,
            lockedUntil: null,
          })
          .where(eq(users.id, user.id));
      },
    },
    socialProviders: config.google
      ? {
          google: {
            clientId: config.google.clientId,
            clientSecret: config.google.clientSecret,
            prompt: "select_account",
          },
        }
      : {},
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (!(await allowTeamSignUp(db, user.email, config.teamDomain))) return false;
            return { data: { ...user, email: user.email.toLowerCase(), kind: "team" } };
          },
        },
      },
      session: {
        create: {
          before: async (session) => allowSession(db, session.userId, config.teamDomain),
        },
      },
    },
    rateLimit: { enabled: true, window: 60, max: 60 },
    telemetry: { enabled: false },
    plugins: config.plugins ?? [],
  });
}

export type Auth = ReturnType<typeof createAuth>;
