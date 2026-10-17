"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/server/db";
import { requireTeam } from "@/server/auth/session";
import { revokeGrant, setMcpEnabled } from "@/server/mcp/oauth";

export async function revokeGrantAction(grantId: string) {
  const { actor } = await requireTeam(["admin"]);
  await revokeGrant(db(), actor, grantId);
  revalidatePath("/team/settings/claude");
}

export async function setMcpEnabledAction(enabled: boolean) {
  const { actor } = await requireTeam(["admin"]);
  await setMcpEnabled(db(), actor, enabled);
  revalidatePath("/team/settings/claude");
}
