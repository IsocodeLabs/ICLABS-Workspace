"use server";

import { redirect } from "next/navigation";
import { db } from "@/server/db";
import { requireTeam } from "@/server/auth/session";
import { checkAuthorizeRequest, issueCode } from "@/server/mcp/oauth";

/** Allow or deny the Claude client, then hand control back to it. */
export async function decideAuthorization(params: Record<string, string>, allow: boolean): Promise<void> {
  const { actor } = await requireTeam(["admin"]);
  const req = await checkAuthorizeRequest(db(), params);
  if (!req.ok) throw new Error(req.error);
  const target = new URL(req.redirectUri);
  if (allow) {
    const code = await issueCode(db(), {
      clientId: req.client.clientId,
      userId: actor.userId,
      redirectUri: req.redirectUri,
      codeChallenge: req.codeChallenge,
      scope: req.scope,
    });
    target.searchParams.set("code", code);
  } else {
    target.searchParams.set("error", "access_denied");
  }
  if (req.state) target.searchParams.set("state", req.state);
  redirect(target.toString());
}
