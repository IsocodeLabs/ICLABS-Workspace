"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, CheckCircle2, AlertTriangle } from "lucide-react";
import { Btn, Input } from "@/components/admin";
import { ConfirmDialog, Dialog } from "@/components/dialog";
import { Alert } from "@/components/ui";
import {
  availabilityAction,
  cancelAction,
  outcomeAction,
  rescheduleAction,
  scheduleAction,
  type InterviewActionResult,
} from "./actions";

type Person = { id: string; email: string; role: string };

function SlotDialog({
  title,
  durationMin,
  initialPanel,
  people,
  exceptInterviewId,
  meet,
  initialLink = "",
  onSubmit,
  onClose,
}: {
  title: string;
  durationMin: number;
  initialPanel: string[];
  people: Person[];
  exceptInterviewId?: string;
  /** A Google Meet interview: offer a link field for when Calendar can't make one. */
  meet: boolean;
  initialLink?: string;
  onSubmit: (input: { startsAt: string; interviewerIds: string[]; force?: boolean; meetUrl?: string }) => Promise<InterviewActionResult>;
  onClose: (done?: boolean) => void;
}) {
  const [when, setWhen] = useState("");
  const [link, setLink] = useState(initialLink);
  const [needsLink, setNeedsLink] = useState(false);
  const [panel, setPanel] = useState<string[]>(initialPanel);
  const [busy, setBusy] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, startCheck] = useTransition();
  const [pending, start] = useTransition();
  const startsAt = when ? new Date(when).toISOString() : "";

  // Check the panel's calendars whenever the time or panel changes.
  useEffect(() => {
    setBusy(null);
    if (!startsAt || panel.length === 0) return;
    const t = setTimeout(
      () =>
        startCheck(async () => {
          const res = await availabilityAction({ interviewerIds: panel, startsAt, durationMin, exceptInterviewId });
          if ("busy" in res) setBusy(res.busy);
        }),
      300,
    );
    return () => clearTimeout(t);
  }, [startsAt, panel, durationMin, exceptInterviewId]);

  const submit = (force: boolean) =>
    start(async () => {
      setError(null);
      const res = await onSubmit({ startsAt, interviewerIds: panel, force, meetUrl: link.trim() || undefined });
      if (res.ok) onClose(true);
      else {
        setError(res.error);
        if (res.conflicts) setBusy(res.conflicts);
        if (res.needsLink) {
          setNeedsLink(true);
          document.getElementById("meet-link")?.focus();
        }
      }
    });

  const sorted = [...people].sort((a, b) => Number(initialPanel.includes(b.id)) - Number(initialPanel.includes(a.id)));
  return (
    <Dialog
      open
      onClose={() => onClose()}
      title={title}
      footer={
        <>
          <Btn variant="secondary" onClick={() => onClose()}>Cancel</Btn>
          {busy && busy.length > 0 ? (
            <Btn variant="danger" disabled={pending || !startsAt} onClick={() => submit(true)}>Book anyway</Btn>
          ) : (
            <Btn variant="gradient" disabled={pending || !startsAt || panel.length === 0} onClick={() => submit(false)}>
              {pending ? "Booking…" : "Book & send invite"}
            </Btn>
          )}
        </>
      }
    >
      {error && <Alert>{error}</Alert>}
      <label className="mb-1 block text-sm font-semibold" htmlFor="when">Start time ({durationMin} min)</label>
      <Input id="when" type="datetime-local" step={900} value={when} onChange={(e) => setWhen(e.target.value)} />
      <p className="mt-4 mb-1 text-sm font-semibold">Panel</p>
      <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-border p-2">
        {sorted.map((p) => (
          <label key={p.id} className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-neutral-bg">
            <input
              type="checkbox"
              checked={panel.includes(p.id)}
              onChange={(e) => setPanel((cur) => (e.target.checked ? [...cur, p.id] : cur.filter((x) => x !== p.id)))}
            />
            <span className="flex-1 text-sm">{p.email}</span>
            {initialPanel.includes(p.id) && <span className="text-xs text-muted">in pool</span>}
          </label>
        ))}
      </div>
      <div className="mt-3 min-h-6 text-sm" aria-live="polite">
        {checking && <span className="text-muted">Checking calendars…</span>}
        {!checking && busy && busy.length === 0 && (
          <span className="inline-flex items-center gap-1.5 text-success-fg"><CheckCircle2 size={16} aria-hidden /> Everyone's free</span>
        )}
        {!checking && busy && busy.length > 0 && (
          <span className="inline-flex items-center gap-1.5 text-warning-fg"><AlertTriangle size={16} aria-hidden /> Busy: {busy.join(", ")}</span>
        )}
      </div>
      {meet && (
        <>
          <label className="mt-3 mb-1 block text-sm font-semibold" htmlFor="meet-link">
            Meeting link {!needsLink && <span className="font-normal text-muted">(optional)</span>}
          </label>
          <Input
            id="meet-link"
            type="url"
            placeholder="https://meet.google.com/…"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            aria-invalid={needsLink && !link.trim()}
          />
          <p className="mt-1 text-xs text-muted">
            Leave empty to have Google Calendar create a Meet link. Paste one if Calendar isn&apos;t connected.
          </p>
        </>
      )}
      <p className="mt-3 text-xs text-muted">
        Adds a Google Calendar event for the panel when Calendar is connected, and emails the candidate an invite (.ics).
      </p>
    </Dialog>
  );
}

export function ScheduleButton({
  applicationId,
  candidateName,
  durationMin,
  mode,
  pool,
  people,
}: {
  applicationId: string;
  candidateName: string;
  durationMin: number;
  mode: string;
  pool: string[];
  people: Person[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Btn size="sm" onClick={() => setOpen(true)}>
        <CalendarPlus size={16} aria-hidden /> Schedule
      </Btn>
      {open && (
        <SlotDialog
          title={`Interview ${candidateName}`}
          durationMin={durationMin}
          initialPanel={pool.filter((id) => people.some((p) => p.id === id))}
          people={people}
          meet={mode === "meet"}
          onSubmit={(input) => scheduleAction(applicationId, input)}
          onClose={(done) => {
            setOpen(false);
            if (done) router.refresh();
          }}
        />
      )}
    </>
  );
}

export function InterviewControls({
  interview,
  people,
  mode,
}: {
  interview: { id: string; durationMin: number; interviewerIds: string[]; mode?: string; meetUrl?: string | null };
  people: Person[];
  mode: "upcoming" | "outcome";
}) {
  const router = useRouter();
  const [moving, setMoving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<InterviewActionResult>) =>
    start(async () => {
      const res = await fn();
      if (res.ok) router.refresh();
      else setError(res.error);
    });

  if (mode === "outcome")
    return (
      <div className="flex items-center gap-2">
        {error && <span role="alert" className="text-sm text-danger-fg">{error}</span>}
        <Btn size="sm" disabled={pending} onClick={() => act(() => outcomeAction(interview.id, "done"))}>Done</Btn>
        <Btn size="sm" variant="secondary" disabled={pending} onClick={() => act(() => outcomeAction(interview.id, "no_show"))}>No-show</Btn>
      </div>
    );

  return (
    <div className="flex items-center gap-1">
      {error && <span role="alert" className="text-sm text-danger-fg">{error}</span>}
      <Btn size="sm" variant="ghost" onClick={() => setMoving(true)}>Move</Btn>
      <Btn size="sm" variant="ghost" className="text-danger-fg" onClick={() => setCancelling(true)}>Cancel</Btn>
      {moving && (
        <SlotDialog
          title="Move interview"
          durationMin={interview.durationMin}
          initialPanel={interview.interviewerIds}
          people={people}
          exceptInterviewId={interview.id}
          meet={interview.mode === "meet"}
          initialLink={interview.meetUrl ?? ""}
          onSubmit={(input) => rescheduleAction(interview.id, input)}
          onClose={(done) => {
            setMoving(false);
            if (done) router.refresh();
          }}
        />
      )}
      <ConfirmDialog
        open={cancelling}
        title="Cancel this interview?"
        body="The candidate gets a cancellation email (and any calendar event is removed). They go back to “Ready to schedule”."
        confirmLabel="Cancel interview"
        onCancel={() => setCancelling(false)}
        onConfirm={() => {
          setCancelling(false);
          act(() => cancelAction(interview.id));
        }}
      />
    </div>
  );
}
