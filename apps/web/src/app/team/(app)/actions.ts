"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { requireTeam } from "@/server/auth/session";
import {
  applyTemplateToDraft,
  cloneCycle,
  createCycle,
  createRole,
  createTrack,
  deleteRole,
  publishDraft,
  updateRole,
  saveDraft,
  saveWorkflowTemplate,
  setCycleStatus,
  type PublishResult,
  type SaveResult,
} from "@/server/hiring/structure";
import { addTeamMember, setAssignment, updateTeamMember } from "@/server/team/members";

export type ActionResult = { ok: true } | { ok: false; error: string };

const roleSchema = z.object({
  title: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{2,40}$/, "Use lowercase letters, numbers and dashes"),
  seats: z.coerce.number().int().min(0).max(1000).optional(),
  description: z.string().trim().max(2000).optional(),
});

export async function createRoleAction(
  _: ActionResult | undefined,
  form: FormData,
): Promise<ActionResult> {
  const { actor } = await requireTeam(["admin"]);
  const parsed = roleSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  try {
    await createRole(db(), actor, parsed.data);
  } catch {
    return { ok: false, error: "A role with that short name already exists." };
  }
  revalidatePath("/team/roles");
  return { ok: true };
}

export async function updateRoleAction(
  _: ActionResult | undefined,
  form: FormData,
): Promise<ActionResult> {
  const { actor } = await requireTeam(["admin"]);
  const roleId = z.string().min(1).max(40).safeParse(form.get("roleId"));
  const parsed = roleSchema.pick({ title: true, slug: true, seats: true }).safeParse({
    title: form.get("title"),
    slug: form.get("slug"),
    seats: form.get("seats") || undefined,
  });
  if (!roleId.success || !parsed.success)
    return { ok: false, error: parsed.error?.issues[0]?.message ?? "Invalid input" };
  try {
    if (!(await updateRole(db(), actor, roleId.data, parsed.data)))
      return { ok: false, error: "That role no longer exists." };
  } catch {
    return { ok: false, error: "A role with that short name already exists." };
  }
  revalidatePath("/team/roles");
  return { ok: true };
}

export async function deleteRoleAction(roleId: string): Promise<ActionResult> {
  const { actor } = await requireTeam(["admin"]);
  const res = await deleteRole(db(), actor, z.string().min(1).max(40).parse(roleId));
  if (res.ok) revalidatePath("/team/roles");
  return res;
}

export async function createCycleAction(
  _: ActionResult | undefined,
  form: FormData,
): Promise<ActionResult> {
  const { actor } = await requireTeam(["admin", "hiring_manager"]);
  const parsed = z
    .object({ roleId: z.string().min(1), name: z.string().trim().min(2).max(80) })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: "Give the round a name." };
  const cycle = await createCycle(db(), actor, parsed.data);
  redirect(`/team/roles/cycles/${cycle.id}`);
}

export async function createTrackAction(
  _: ActionResult | undefined,
  form: FormData,
): Promise<ActionResult> {
  const { actor } = await requireTeam(["admin", "hiring_manager"]);
  const parsed = z
    .object({ cycleId: z.string().min(1), name: z.string().trim().min(2).max(80) })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: "Give the track a name." };
  const track = await createTrack(db(), actor, parsed.data);
  redirect(`/team/builder/${track.id}`);
}

export async function cloneCycleAction(cycleId: string, name: string): Promise<void> {
  const { actor } = await requireTeam(["admin", "hiring_manager"]);
  const copy = await cloneCycle(db(), actor, { cycleId, name: name.trim() || "Copy" });
  redirect(`/team/roles/cycles/${copy.id}`);
}

export async function setCycleStatusAction(
  cycleId: string,
  status: "draft" | "open" | "closed" | "archived",
): Promise<void> {
  const { actor } = await requireTeam(["admin"]);
  await setCycleStatus(db(), actor, { cycleId, status });
  revalidatePath(`/team/roles/cycles/${cycleId}`);
}

// ─── Builder ─────────────────────────────────────────────────────────────────

export async function saveDraftAction(input: {
  workflowId: string;
  versionId: string;
  config: unknown;
  etag: string;
}): Promise<SaveResult> {
  const { actor } = await requireTeam(["admin", "hiring_manager"]);
  return saveDraft(db(), actor, input);
}

export async function publishAction(input: {
  workflowId: string;
  versionId: string;
}): Promise<PublishResult> {
  const { actor } = await requireTeam(["admin"]);
  const result = await publishDraft(db(), actor, input);
  revalidatePath(`/team/builder/${input.workflowId}`);
  return result;
}

export async function saveTemplateAction(input: {
  workflowId: string;
  name: string;
}): Promise<ActionResult> {
  const { actor } = await requireTeam(["admin", "hiring_manager"]);
  if (input.name.trim().length < 2) return { ok: false, error: "Name the template." };
  await saveWorkflowTemplate(db(), actor, {
    workflowId: input.workflowId,
    name: input.name.trim(),
  });
  return { ok: true };
}

export async function applyTemplateAction(input: {
  workflowId: string;
  templateId: string;
}): Promise<SaveResult> {
  const { actor } = await requireTeam(["admin", "hiring_manager"]);
  const result = await applyTemplateToDraft(db(), actor, input);
  revalidatePath(`/team/builder/${input.workflowId}`);
  return result;
}

// ─── Team ────────────────────────────────────────────────────────────────────

const teamRole = z.enum(["admin", "hiring_manager", "reviewer", "interviewer"]);

export async function addTeamMemberAction(
  _: ActionResult | undefined,
  form: FormData,
): Promise<ActionResult> {
  const { actor } = await requireTeam(["admin"]);
  const parsed = z.object({ email: z.email(), role: teamRole }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: "Enter an email and a role." };
  try {
    await addTeamMember(db(), actor, { ...parsed.data, teamDomain: env().TEAM_EMAIL_DOMAIN });
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  revalidatePath("/team/settings/team");
  return { ok: true };
}

export async function updateTeamMemberAction(input: {
  id: string;
  role?: z.infer<typeof teamRole>;
  active?: boolean;
}): Promise<ActionResult> {
  const { actor } = await requireTeam(["admin"]);
  try {
    await updateTeamMember(db(), actor, input);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  revalidatePath("/team/settings/team");
  return { ok: true };
}

export async function setAssignmentAction(input: {
  teamMemberId: string;
  scope: "role" | "workflow";
  scopeId: string;
  assigned: boolean;
}): Promise<void> {
  const { actor } = await requireTeam(["admin"]);
  await setAssignment(db(), actor, input);
  revalidatePath("/team/settings/team");
}
