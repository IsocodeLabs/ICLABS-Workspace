import { redirect } from "next/navigation";
import { AuthShell } from "@/components/ui";
import { maintenanceBlock } from "@/server/maintenance";

export const dynamic = "force-dynamic";

/** What candidates see while the workspace is being updated. */
export default async function MaintenancePage() {
  const m = await maintenanceBlock();
  if (!m) redirect("/");
  return (
    <AuthShell
      title="Isocode Workspace is under maintenance"
      subtitle={`We're updating the workspace. It will be back live by ${m.backBy} today. Your answers and progress are safe.`}
    >
      <p className="text-sm text-muted">
        Please check back after {m.backBy}. For any query, write to{" "}
        <a href="mailto:hr@isocodelabs.com" className="font-semibold underline">
          hr@isocodelabs.com
        </a>
        .
      </p>
    </AuthShell>
  );
}
