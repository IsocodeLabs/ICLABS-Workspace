import Link from "next/link";
import { ArrowRight, Clock, UserPlus } from "lucide-react";
import { Card, EmptyState, Page, PageHeader } from "@/components/admin";
import { StatusPill } from "@/components/ui";
import { db } from "@/server/db";
import { requireTeam } from "@/server/auth/session";
import { listReviewers } from "@/server/reviews/assign";
import { myQueue, unassignedQueue, type QueueItem } from "@/server/reviews/queue";
import { AssignPicker } from "./assign-picker";

const ago = (d: Date | null) => {
  if (!d) return "";
  const h = Math.round((Date.now() - d.getTime()) / 3600_000);
  return h < 1 ? "just now" : h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};

function Row({ item }: { item: QueueItem }) {
  return (
    <Link
      href={`/team/reviews/${item.assignmentId}`}
      className="group flex items-center gap-4 rounded-xl border border-border bg-surface px-4 py-3 transition hover:border-brand-500 hover:shadow-card"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{item.candidateLabel}</p>
        <p className="truncate text-sm text-muted">
          {item.stageTitle} · {item.roleTitle}
        </p>
      </div>
      {item.reason === "borderline_second" && (
        <StatusPill tone="warning">Second opinion</StatusPill>
      )}
      {item.late && <StatusPill tone="warning">Late</StatusPill>}
      <span className="flex items-center gap-1 text-sm text-muted">
        <Clock size={14} aria-hidden /> {ago(item.submittedAt ?? item.assignedAt)}
      </span>
      <ArrowRight
        size={18}
        className="text-muted transition group-hover:translate-x-0.5 group-hover:text-brand-500"
        aria-hidden
      />
    </Link>
  );
}

export default async function ReviewsPage() {
  const { actor } = await requireTeam(["admin", "hiring_manager", "reviewer"]);
  const manages = actor.role === "admin" || actor.role === "hiring_manager";
  const [queue, unassigned, reviewers] = await Promise.all([
    myQueue(db(), actor),
    manages ? unassignedQueue(db(), actor) : Promise.resolve([]),
    manages ? listReviewers(db()) : Promise.resolve([]),
  ]);
  return (
    <Page>
      <PageHeader
        title="My reviews"
        subtitle={
          queue.open.length
            ? `${queue.open.length} waiting for your score, oldest first.`
            : "Nothing waiting for you right now."
        }
      />

      <section className="space-y-2">
        {queue.open.length === 0 ? (
          <EmptyState
            title="You're all caught up"
            body="New submissions assigned to you show up here and in your notifications."
          />
        ) : (
          queue.open.map((i) => <Row key={i.assignmentId} item={i} />)
        )}
      </section>

      {manages && (
        <section className="mt-10">
          <h2 className="mb-3 flex items-center gap-2 font-display text-xl font-bold">
            <UserPlus size={20} aria-hidden /> Needs a reviewer
          </h2>
          {unassigned.length === 0 ? (
            <p className="on-liquid">Every submitted stage has a reviewer.</p>
          ) : (
            <Card className="divide-y divide-border p-0">
              {unassigned.map((u) => (
                <div key={u.progressId} className="flex flex-wrap items-center gap-4 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{u.candidateName}</p>
                    <p className="text-sm text-muted">
                      {u.stageTitle} · {u.roleTitle} · submitted {ago(u.submittedAt)}
                    </p>
                  </div>
                  <AssignPicker progressId={u.progressId} reviewers={reviewers} />
                </div>
              ))}
            </Card>
          )}
        </section>
      )}

      {queue.done.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 font-display text-xl font-bold">Recently reviewed</h2>
          <div className="space-y-2 opacity-80">
            {queue.done.map((i) => (
              <Row key={i.assignmentId} item={i} />
            ))}
          </div>
        </section>
      )}
    </Page>
  );
}
