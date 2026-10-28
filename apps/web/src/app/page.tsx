import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";
import { maintenanceBlock } from "@/server/maintenance";

export default async function Home() {
  const session = await getSession();
  if (session?.user.kind !== "team" && (await maintenanceBlock())) redirect("/maintenance");
  if (!session) redirect("/login");
  redirect(session.user.kind === "team" ? "/team" : "/dashboard");
}
