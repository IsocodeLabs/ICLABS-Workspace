import { getTranslations } from "next-intl/server";
import { db } from "@/server/db";
import { requireCandidate } from "@/server/auth/session";
import { getProfile } from "@/server/portal";
import { ProfileForm } from "./profile-form";

export default async function ProfilePage() {
  const { actor, session } = await requireCandidate();
  const t = await getTranslations("profile");
  const p = await getProfile(db(), actor);
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="font-display text-3xl font-bold tracking-tight">{t("title")}</h1>
      <p className="mt-2 text-muted">{t("subtitle")}</p>
      <p className="mt-1 text-sm font-semibold">{session.user.email}</p>
      <ProfileForm
        initial={{
          name: p.name,
          phone: p.phone ?? "",
          college: p.college ?? "",
          gradYear: p.gradYear ? String(p.gradYear) : "",
          linkedin: p.linkedin ?? "",
          github: p.github ?? "",
          portfolio: p.portfolio ?? "",
          skills: p.skills.join(", "),
          availableFrom: p.availableFrom ?? "",
          availableTo: p.availableTo ?? "",
          preferredStart: p.preferredStart ?? "",
        }}
      />
    </main>
  );
}
