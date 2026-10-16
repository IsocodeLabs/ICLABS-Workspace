import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";

export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/login");
  redirect(session.user.kind === "team" ? "/team" : "/dashboard");
}
