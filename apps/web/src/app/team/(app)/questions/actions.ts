"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/server/db";
import { requireTeam } from "@/server/auth/session";
import { createQuestion, setQuestionStatus, updateQuestion } from "@/server/questions";

export async function saveQuestionAction(id: string | null, input: unknown) {
  const { actor } = await requireTeam(["admin", "hiring_manager"]);
  const result = id
    ? await updateQuestion(db(), actor, id, input)
    : await createQuestion(db(), actor, input);
  revalidatePath("/team/questions");
  return result;
}

export async function setQuestionStatusAction(
  id: string,
  status: "approved" | "archived" | "draft",
) {
  const { actor } = await requireTeam(["admin"]);
  await setQuestionStatus(db(), actor, id, status);
  revalidatePath("/team/questions");
}
