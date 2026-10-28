import Link from "next/link";
import { AuthShell } from "@/components/ui";
import { requireTeam } from "@/server/auth/session";
import { isTesting, maintenance } from "@/server/maintenance";
import { setMaintenanceAction, startTestingAction, stopTestingAction } from "./actions";

export const dynamic = "force-dynamic";

const btn = "rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600";
const btn2 =
  "rounded-xl border border-border px-4 py-2 text-sm font-semibold hover:border-brand-500";

/**
 * Admins only. Maintenance mode on/off, and testing mode for this browser: while maintenance
 * is on, candidates see the notice, but a testing browser uses the workspace as normal.
 */
export default async function TestingPage() {
  await requireTeam(["admin"]);
  const m = await maintenance();
  const testing = await isTesting();
  return (
    <AuthShell
      title="Maintenance and testing"
      subtitle="Candidates see a maintenance notice while it's on. Team pages keep working."
    >
      <div className="space-y-6 text-sm">
        <section>
          <p className="mb-2 font-semibold">
            Maintenance mode is{" "}
            {m.on ? "ON: candidates see the notice" : "OFF: the workspace is live"}
          </p>
          <form action={setMaintenanceAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="on" value={m.on ? "0" : "1"} />
            <label className="flex flex-col gap-1">
              <span className="text-muted">Back live by</span>
              <input
                name="backBy"
                defaultValue={m.backBy}
                className="rounded-xl border border-border bg-surface px-3 py-2"
              />
            </label>
            <button className={m.on ? btn2 : btn}>
              {m.on ? "Turn maintenance off (go live)" : "Turn maintenance on"}
            </button>
          </form>
        </section>
        <section>
          <p className="mb-2 font-semibold">
            Testing mode in this browser is {testing ? "ON" : "OFF"}
          </p>
          <p className="mb-3 text-muted">
            With testing on, this browser skips the maintenance notice. Sign out and sign in with a
            test candidate account to try the candidate side.
          </p>
          <div className="flex flex-wrap gap-2">
            <form action={testing ? stopTestingAction : startTestingAction}>
              <button className={testing ? btn2 : btn}>
                {testing ? "Stop testing in this browser" : "Start testing in this browser"}
              </button>
            </form>
            {testing && (
              <Link href="/login" className={btn2}>
                Candidate sign-in
              </Link>
            )}
          </div>
        </section>
      </div>
    </AuthShell>
  );
}
