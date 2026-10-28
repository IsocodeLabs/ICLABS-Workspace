"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/server/db";
import { requireTeam } from "@/server/auth/session";
import { TESTING_COOKIE, setMaintenance, testingToken } from "@/server/maintenance";

export async function setMaintenanceAction(form: FormData) {
  const { actor } = await requireTeam(["admin"]);
  const backBy =
    String(form.get("backBy") ?? "")
      .trim()
      .slice(0, 40) || "6 pm IST";
  await setMaintenance(db(), actor, { on: form.get("on") === "1", backBy });
  redirect("/testing");
}

/** This browser skips the notice (12 hours), to test the candidate side. */
export async function startTestingAction() {
  await requireTeam(["admin"]);
  (await cookies()).set(TESTING_COOKIE, testingToken(), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 12 * 3600,
  });
  redirect("/testing");
}

export async function stopTestingAction() {
  (await cookies()).delete(TESTING_COOKIE);
  redirect("/testing");
}
