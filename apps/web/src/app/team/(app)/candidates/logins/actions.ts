"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formatIst } from "@iclabs/core";
import { db } from "@/server/db";
import { appUrl, queueEmail } from "@/server/email";
import { requireTeam } from "@/server/auth/session";
import { loginCheck, resendTrackLogins, RESENDABLE } from "@/server/candidates/logins";

const input = z.object({ workflowId: z.string().min(1).max(40) });

export type LoginCheckView = {
  total: number;
  signedIn: number;
  waiting: number;
  resendable: number;
  problems: { name: string; email: string; problem: string; lastEmail: string }[];
};

export async function loginCheckAction(raw: unknown): Promise<LoginCheckView | null> {
  const { actor } = await requireTeam(["admin"]);
  const parsed = input.safeParse(raw);
  if (!parsed.success) return null;
  const res = await loginCheck(db(), actor, parsed.data.workflowId);
  return {
    total: res.total,
    signedIn: res.signedIn,
    waiting: res.waiting,
    resendable: res.problems.filter((p) => RESENDABLE.includes(p.problem)).length,
    problems: res.problems.map((p) => ({
      name: p.name,
      email: p.email,
      problem: p.problem,
      lastEmail: p.lastEmail ? formatIst(p.lastEmail) : "—",
    })),
  };
}

/** Resends only if the count still matches what the admin reviewed. */
export async function resendLoginsAction(
  raw: unknown,
  reviewed: number,
): Promise<{ ok: true; resent: number } | { ok: false; error: string }> {
  const { actor } = await requireTeam(["admin"]);
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Pick a track." };
  const now = await loginCheck(db(), actor, parsed.data.workflowId);
  const count = now.problems.filter((p) => RESENDABLE.includes(p.problem)).length;
  if (count !== reviewed)
    return {
      ok: false,
      error: `The list changed: ${count} people now, you reviewed ${reviewed}. Check again.`,
    };
  const res = await resendTrackLogins(db(), actor, parsed.data.workflowId, {
    queueEmail,
    loginUrl: appUrl("/login"),
  });
  revalidatePath("/team/candidates");
  return { ok: true, ...res };
}
