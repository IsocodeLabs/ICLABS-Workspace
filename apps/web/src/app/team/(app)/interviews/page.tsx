import Link from "next/link";
import { CalendarClock, MapPin, Phone, Video } from "lucide-react";
import { formatIst } from "@iclabs/core";
import { Card, EmptyState, Page, PageHeader } from "@/components/admin";
import { StatusPill } from "@/components/ui";
import { db } from "@/server/db";
import { requireTeam } from "@/server/auth/session";
import { interviewBoard, interviewerOptions } from "@/server/interviews";
import { InterviewControls, ScheduleButton } from "./schedule";

const ModeIcon = ({ mode }: { mode: string }) =>
  mode === "meet" ? <Video size={15} aria-hidden /> : mode === "phone" ? <Phone size={15} aria-hidden /> : <MapPin size={15} aria-hidden />;

const dayKey = (d: Date) =>
  d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long" });
const time = (d: Date) => d.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });

export default async function InterviewsPage() {
  const { actor } = await requireTeam();
  const manages = actor.role === "admin" || actor.role === "hiring_manager";
  const [board, people] = await Promise.all([interviewBoard(db(), actor), manages ? interviewerOptions(db()) : Promise.resolve([])]);
  const now = new Date();
  const awaitingOutcome = board.upcoming.filter((i) => i.endsAt < now);
  const upcoming = board.upcoming.filter((i) => i.endsAt >= now);
  const days = new Map<string, typeof upcoming>();
  for (const i of upcoming) days.set(dayKey(i.startsAt), [...(days.get(dayKey(i.startsAt)) ?? []), i]);

  return (
    <Page>
      <PageHeader
        title="Interviews"
        subtitle={manages ? "Book interviews for shortlisted candidates. Times are in IST." : "Interviews you're on. Times are in IST."}
      />

      {manages && (
        <section className="mb-10">
          <h2 className="mb-3 font-display text-xl font-bold">Ready to schedule</h2>
          {board.ready.length === 0 ? (
            <p className="text-muted">Nobody is waiting for an interview slot.</p>
          ) : (
            <Card className="divide-y divide-border p-0">
              {board.ready.map((r) => (
                <div key={r.applicationId} className="flex flex-wrap items-center gap-4 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{r.candidateName}</p>
                    <p className="text-sm text-muted">
                      {r.roundName} · {r.roleTitle} · {r.durationMin} min · waiting since {formatIst(r.waitingSince)}
                    </p>
                  </div>
                  <ScheduleButton
                    applicationId={r.applicationId}
                    candidateName={r.candidateName}
                    durationMin={r.durationMin}
                    pool={r.pool}
                    people={people}
                  />
                </div>
              ))}
            </Card>
          )}
        </section>
      )}

      {awaitingOutcome.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 font-display text-xl font-bold">How did it go?</h2>
          <Card className="divide-y divide-border p-0">
            {awaitingOutcome.map((i) => (
              <div key={i.id} className="flex flex-wrap items-center gap-4 px-5 py-3">
                <Link href={`/team/interviews/${i.id}`} className="min-w-0 flex-1">
                  <p className="font-semibold hover:underline">{i.candidateName}</p>
                  <p className="text-sm text-muted">{i.roundName} · {formatIst(i.startsAt)}</p>
                </Link>
                {manages && <InterviewControls interview={{ id: i.id, durationMin: 0, interviewerIds: i.interviewerIds }} people={people} mode="outcome" />}
              </div>
            ))}
          </Card>
        </section>
      )}

      <section>
        <h2 className="mb-3 flex items-center gap-2 font-display text-xl font-bold">
          <CalendarClock size={20} aria-hidden /> Upcoming
        </h2>
        {upcoming.length === 0 ? (
          <EmptyState title="No interviews booked" body={manages ? "Schedule someone from the list above." : "You'll get a notification when you're added to a panel."} />
        ) : (
          <div className="space-y-6">
            {[...days.entries()].map(([day, items]) => (
              <div key={day}>
                <p className="mb-2 text-sm font-bold uppercase tracking-wide text-brand-600">{day}</p>
                <div className="space-y-2">
                  {items.map((i) => (
                    <div key={i.id} className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-surface px-4 py-3">
                      <p className="w-24 font-display text-lg font-bold tabular-nums">{time(i.startsAt)}</p>
                      <Link href={`/team/interviews/${i.id}`} className="min-w-0 flex-1">
                        <p className="font-semibold hover:underline">{i.candidateName}</p>
                        <p className="flex items-center gap-1.5 text-sm text-muted">
                          <ModeIcon mode={i.mode} /> {i.roundName} · {i.panel.join(", ")}
                        </p>
                      </Link>
                      {i.rescheduleCount > 0 && <StatusPill tone="neutral">Moved</StatusPill>}
                      {i.meetUrl && (
                        <a href={i.meetUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-brand-600 underline">
                          Join Meet
                        </a>
                      )}
                      {manages && (
                        <InterviewControls
                          interview={{ id: i.id, durationMin: Math.round((i.endsAt.getTime() - i.startsAt.getTime()) / 60_000), interviewerIds: i.interviewerIds }}
                          people={people}
                          mode="upcoming"
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {board.past.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 font-display text-xl font-bold">Recent</h2>
          <div className="space-y-2 opacity-80">
            {board.past.map((i) => (
              <Link key={i.id} href={`/team/interviews/${i.id}`} className="flex items-center gap-4 rounded-xl border border-border bg-surface px-4 py-2.5 hover:border-brand-500">
                <span className="flex-1 font-semibold">{i.candidateName}</span>
                <span className="text-sm text-muted">{i.roundName} · {formatIst(i.startsAt)}</span>
                <StatusPill tone={i.status === "done" ? "success" : "warning"}>{i.status === "done" ? "Done" : "No-show"}</StatusPill>
              </Link>
            ))}
          </div>
        </section>
      )}
    </Page>
  );
}
