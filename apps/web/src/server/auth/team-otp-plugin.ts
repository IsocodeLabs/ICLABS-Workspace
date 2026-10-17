import type { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";
import type { Db } from "@iclabs/db";
import { verifyTeamCode } from "./team-auth";

/**
 * Turns a correct emailed code into a session, the supported way (same as Better Auth's
 * magic-link plugin): create the session, then set the signed cookie. Called server-side from
 * the verify page's action; the HTTP route guard keeps it off the public API.
 * Session creation still runs the allow-list hook, so a removed team member gets nothing.
 */
export function teamOtpPlugin(db: Db): BetterAuthPlugin {
  return {
    id: "team-otp",
    endpoints: {
      verifyTeamOtp: createAuthEndpoint(
        "/team-otp/verify",
        {
          method: "POST",
          body: z.object({ challenge: z.string().min(20).max(200), code: z.string().min(1).max(20) }),
        },
        async (ctx) => {
          const result = await verifyTeamCode(db, ctx.body);
          if (!result.ok) return ctx.json(result);
          const user = await ctx.context.internalAdapter.findUserById(result.userId);
          if (!user) return ctx.json({ ok: false as const, reason: "expired" as const });
          const session = await ctx.context.internalAdapter.createSession(user.id);
          if (!session) return ctx.json({ ok: false as const, reason: "expired" as const });
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ ok: true as const });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
