import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  ne,
  applications,
  candidates,
  files,
  interviews,
  reviews,
  stageProgress,
  submissions,
  teamMembers,
  users,
  type Db,
} from "@iclabs/db";
import { can, formatIst, taskSubmissionFields, type Actor } from "@iclabs/core";
import { ulid } from "ulid";
import { assertCan, audit } from "../audit";
import { type CalendarClient, overlaps } from "../calendar";
import { buildIcs } from "../calendar/ics";
import { notify } from "../portal";
import { buildRuleContext, stageScores } from "../reviews/context";
import {
  advanceFrom,
  loadPinned,
  notifyAdmins,
  type PinnedApplication,
  type ProgressionDeps,
} from "../stages/progression";

/** `calendar` is null until Google Calendar is connected: interviews still book, with the app's own invite email. */
export type InterviewDeps = ProgressionDeps & {
  calendar: CalendarClient | null;
  organizerEmail: string;
};
type TeamActor = Actor & { kind: "team" };
type Result<T = object> =
  ({ ok: true } & T) | { ok: false; error: string; conflicts?: string[]; needsLink?: boolean };

const firstName = (n: string) => n.split(" ")[0]!;

function interviewNode(pinned: PinnedApplication, nodeId: string | null) {
  const node = pinned.config.nodes.find((n) => n.id === nodeId);
  return node?.type === "interview" ? node : null;
}

async function panel(db: Db, ids: string[]) {
  if (ids.length === 0) return [];
  return db
    .select({ id: teamMembers.id, email: teamMembers.email, userId: teamMembers.userId })
    .from(teamMembers)
    .where(and(inArray(teamMembers.id, ids), eq(teamMembers.active, true)));
}

/** Panel members already booked in the workspace for an overlapping slot. */
async function internalConflicts(
  db: Db,
  memberIds: string[],
  start: Date,
  end: Date,
  exceptId?: string,
) {
  const rows = await db
    .select({
      id: interviews.id,
      interviewerIds: interviews.interviewerIds,
      startsAt: interviews.startsAt,
      endsAt: interviews.endsAt,
    })
    .from(interviews)
    .where(
      and(
        eq(interviews.status, "scheduled"),
        gt(interviews.endsAt, start),
        exceptId ? ne(interviews.id, exceptId) : undefined,
      ),
    );
  const busy = new Set<string>();
  for (const r of rows) {
    if (!overlaps({ start: r.startsAt, end: r.endsAt }, { start, end })) continue;
    for (const m of r.interviewerIds) if (memberIds.includes(m)) busy.add(m);
  }
  return [...busy];
}

function where(mode: string, meetUrl: string | null, location: string | null) {
  if (mode === "meet") return meetUrl ?? "Google Meet (link in the calendar invite)";
  if (mode === "phone") return "Phone call: we'll call the number on your profile";
  return location ?? "Isocode Labs office";
}

async function emailCandidate(
  deps: InterviewDeps,
  pinned: PinnedApplication,
  iv: {
    id: string;
    roundName: string;
    startsAt: Date;
    endsAt: Date;
    mode: string;
    meetUrl: string | null;
    location: string | null;
    sequence: number;
  },
  kind: "scheduled" | "moved" | "cancelled",
  instructions?: string,
) {
  const place = where(iv.mode, iv.meetUrl, iv.location);
  const ics = buildIcs({
    uid: iv.id,
    sequence: iv.sequence,
    method: kind === "cancelled" ? "CANCEL" : "REQUEST",
    start: iv.startsAt,
    end: iv.endsAt,
    summary: `${iv.roundName} · Isocode Labs (${pinned.roleTitle})`,
    description: `${iv.roundName} for ${pinned.roleTitle}.${iv.meetUrl ? `\nJoin: ${iv.meetUrl}` : ""}`,
    location: place,
    organizerEmail: deps.organizerEmail,
    attendeeEmail: pinned.email,
    now: deps.now?.(),
  });
  const attachments = [
    {
      filename: "interview.ics",
      content: ics,
      contentType:
        "text/calendar; charset=utf-8; method=" + (kind === "cancelled" ? "CANCEL" : "REQUEST"),
    },
  ];
  const base = { first_name: firstName(pinned.candidateName), role: pinned.roleTitle };
  if (kind === "scheduled") {
    await deps.queueEmail({
      to: pinned.email,
      templateKey: "interview_scheduled",
      userId: pinned.userId,
      applicationId: pinned.app.id,
      vars: {
        ...base,
        round: iv.roundName,
        when: formatIst(iv.startsAt),
        where: place,
        instructions: instructions ?? "",
      },
      attachments,
    });
  } else {
    await deps.queueEmail({
      to: pinned.email,
      templateKey: "interview_updated",
      userId: pinned.userId,
      applicationId: pinned.app.id,
      vars: {
        ...base,
        update:
          kind === "moved"
            ? `Your ${iv.roundName} has moved to ${formatIst(iv.startsAt)}. Where: ${place}. The attached invite replaces the old one.`
            : `Your ${iv.roundName} on ${formatIst(iv.startsAt)} has been cancelled. We'll be in touch about next steps.`,
      },
      attachments,
    });
  }
}

/** An admin (or the role's hiring manager) books a time with a panel. */
export async function scheduleInterview(
  db: Db,
  deps: InterviewDeps,
  actor: TeamActor,
  applicationId: string,
  input: { startsAt: Date; interviewerIds: string[]; force?: boolean; meetUrl?: string },
): Promise<Result<{ interviewId: string }>> {
  const pinned = await loadPinned(db, applicationId);
  assertCan(actor, "write", {
    type: "workflow",
    roleId: pinned.app.roleId,
    workflowId: pinned.app.workflowId,
  });
  const node = interviewNode(pinned, pinned.app.currentNodeId);
  if (!node) return { ok: false, error: "This candidate isn't at an interview stage." };
  if (pinned.app.status !== "active")
    return { ok: false, error: "Only active candidates can be scheduled." };
  const [progress] = await db
    .select()
    .from(stageProgress)
    .where(and(eq(stageProgress.applicationId, applicationId), eq(stageProgress.nodeId, node.id)));
  if (!progress) return { ok: false, error: "Stage not reached." };
  const now = deps.now?.() ?? new Date();
  if (input.startsAt.getTime() < now.getTime() + 15 * 60_000)
    return { ok: false, error: "Pick a time at least 15 minutes from now." };
  const people = await panel(db, input.interviewerIds);
  if (people.length === 0) return { ok: false, error: "Pick at least one interviewer." };
  const endsAt = new Date(input.startsAt.getTime() + node.config.durationMin * 60_000);

  const conflicts = await findConflicts(db, deps, people, input.startsAt, endsAt);
  if (conflicts.length && !input.force)
    return { ok: false, error: `Busy then: ${conflicts.join(", ")}`, conflicts };

  const id = ulid();
  // Google Calendar adds the event to everyone's calendar and makes the Meet link. Without it
  // (not connected yet, or down) the interview still books: the candidate gets the app's own
  // invite (.ics) and the panel an in-app notice, but a Meet interview then needs a pasted link.
  let eventId: string | null = null;
  let meetUrl = input.meetUrl ?? null;
  let calendarError: string | null = deps.calendar ? null : "Google Calendar isn't connected yet";
  if (deps.calendar) {
    try {
      const ev = await deps.calendar.createEvent({
        requestId: id,
        summary: `${node.config.roundName}: ${pinned.candidateName} (${pinned.roleTitle})`,
        description: `Interview brief: ${deps.appUrl(`/team/interviews/${id}`)}`,
        start: input.startsAt,
        end: endsAt,
        attendees: [...people.map((p) => p.email), pinned.email],
        withMeet: node.config.mode === "meet" && !input.meetUrl,
        location: node.config.mode === "in_person" ? node.config.address : undefined,
      });
      eventId = ev.eventId;
      meetUrl = input.meetUrl ?? ev.meetUrl;
    } catch (err) {
      console.error("[interviews] calendar event failed", err instanceof Error ? err.message : err);
      calendarError = "Google Calendar didn't accept the event";
    }
  }
  if (node.config.mode === "meet" && !meetUrl)
    return {
      ok: false,
      needsLink: true,
      error: `${calendarError ?? "Google Calendar didn't return a Meet link"}, so there's no meeting link. Paste a Google Meet or Zoom link to book anyway.`,
    };
  try {
    await db.insert(interviews).values({
      id,
      applicationId,
      stageProgressId: progress.id,
      nodeId: node.id,
      roundName: node.config.roundName,
      startsAt: input.startsAt,
      endsAt,
      interviewerIds: people.map((p) => p.id),
      mode: node.config.mode,
      location: node.config.address ?? null,
      meetUrl,
      calendarEventId: eventId,
      createdBy: actor.userId,
      // Same clock as the reminder sweep, which compares booking time with start time.
      createdAt: now,
    });
  } catch {
    // Someone else booked this stage a moment ago: undo our calendar event.
    if (eventId) await deps.calendar?.cancelEvent(eventId).catch(() => {});
    return { ok: false, error: "This candidate was just scheduled by someone else." };
  }
  await db
    .update(stageProgress)
    .set({ state: "in_progress" })
    .where(eq(stageProgress.id, progress.id));
  await db
    .update(applications)
    .set({ status: "interview_scheduled" })
    .where(eq(applications.id, applicationId));
  await emailCandidate(
    deps,
    pinned,
    {
      id,
      roundName: node.config.roundName,
      startsAt: input.startsAt,
      endsAt,
      mode: node.config.mode,
      meetUrl,
      location: node.config.address ?? null,
      sequence: 0,
    },
    "scheduled",
    node.config.instructions,
  );
  await notify(db, [
    ...people
      .filter((p) => p.userId)
      .map((p) => ({
        userId: p.userId!,
        kind: "interview_assigned",
        title: `${node.config.roundName} with ${pinned.candidateName}`,
        body: formatIst(input.startsAt),
        link: `/team/interviews/${id}`,
      })),
    {
      userId: pinned.userId,
      kind: "interview_scheduled",
      title: `${node.config.roundName} booked`,
      body: formatIst(input.startsAt),
      link: `/roles/${applicationId}`,
    },
  ]);
  await audit(db, {
    actorUserId: actor.userId,
    action: "interview_scheduled",
    entity: "interview",
    entityId: id,
    after: {
      startsAt: input.startsAt.toISOString(),
      interviewerIds: people.map((p) => p.id),
      overrodeConflicts: conflicts.length > 0,
      calendarEvent: !!eventId,
    },
  });
  return { ok: true, interviewId: id };
}

async function findConflicts(
  db: Db,
  deps: InterviewDeps,
  people: { id: string; email: string }[],
  start: Date,
  end: Date,
  exceptId?: string,
) {
  const internal = await internalConflicts(
    db,
    people.map((p) => p.id),
    start,
    end,
    exceptId,
  );
  let external: string[] = [];
  try {
    // Without Google Calendar only clashes with other workspace interviews are known.
    const busy = deps.calendar
      ? await deps.calendar.freeBusy(
          people.map((p) => p.email),
          start,
          end,
        )
      : {};
    external = people
      .filter((p) => !internal.includes(p.id))
      .filter((p) => (busy[p.email] ?? []).some((w) => overlaps(w, { start, end })))
      .map((p) => p.id);
    // On reschedule the existing event shows as busy; it's ours, so ignore it.
    if (exceptId) {
      const [own] = await db.select().from(interviews).where(eq(interviews.id, exceptId));
      if (own)
        external = external.filter(
          (m) =>
            !(
              own.interviewerIds.includes(m) &&
              overlaps({ start: own.startsAt, end: own.endsAt }, { start, end })
            ),
        );
    }
  } catch (err) {
    console.error("[interviews] free/busy failed", err instanceof Error ? err.message : err);
  }
  const ids = new Set([...internal, ...external]);
  return people.filter((p) => ids.has(p.id)).map((p) => p.email);
}

async function loadInterview(db: Db, actor: TeamActor, interviewId: string) {
  const [iv] = await db.select().from(interviews).where(eq(interviews.id, interviewId));
  if (!iv) return null;
  const pinned = await loadPinned(db, iv.applicationId);
  assertCan(actor, "write", {
    type: "workflow",
    roleId: pinned.app.roleId,
    workflowId: pinned.app.workflowId,
  });
  return { iv, pinned };
}

export async function rescheduleInterview(
  db: Db,
  deps: InterviewDeps,
  actor: TeamActor,
  interviewId: string,
  input: { startsAt: Date; interviewerIds?: string[]; force?: boolean; meetUrl?: string },
): Promise<Result> {
  const loaded = await loadInterview(db, actor, interviewId);
  if (!loaded) return { ok: false, error: "Interview not found." };
  const { iv, pinned } = loaded;
  if (iv.status !== "scheduled")
    return { ok: false, error: "Only upcoming interviews can be moved." };
  const now = deps.now?.() ?? new Date();
  if (input.startsAt.getTime() < now.getTime() + 15 * 60_000)
    return { ok: false, error: "Pick a time at least 15 minutes from now." };
  const people = await panel(db, input.interviewerIds ?? iv.interviewerIds);
  if (people.length === 0) return { ok: false, error: "Pick at least one interviewer." };
  const endsAt = new Date(input.startsAt.getTime() + (iv.endsAt.getTime() - iv.startsAt.getTime()));
  const conflicts = await findConflicts(db, deps, people, input.startsAt, endsAt, iv.id);
  if (conflicts.length && !input.force)
    return { ok: false, error: `Busy then: ${conflicts.join(", ")}`, conflicts };

  let meetUrl = input.meetUrl ?? iv.meetUrl;
  if (iv.calendarEventId && deps.calendar) {
    const res = await deps.calendar.updateEvent(iv.calendarEventId, {
      summary: `${iv.roundName}: ${pinned.candidateName} (${pinned.roleTitle})`,
      description: `Interview brief: ${deps.appUrl(`/team/interviews/${iv.id}`)}`,
      start: input.startsAt,
      end: endsAt,
      attendees: [...people.map((p) => p.email), pinned.email],
      withMeet: iv.mode === "meet",
      location: iv.mode === "in_person" ? (iv.location ?? undefined) : undefined,
    });
    meetUrl = input.meetUrl ?? res.meetUrl ?? meetUrl;
  }
  await db
    .update(interviews)
    .set({
      startsAt: input.startsAt,
      endsAt,
      interviewerIds: people.map((p) => p.id),
      meetUrl,
      rescheduleCount: iv.rescheduleCount + 1,
      reminderDaySentAt: null,
      reminderHourSentAt: null,
    })
    .where(eq(interviews.id, iv.id));
  await emailCandidate(
    deps,
    pinned,
    { ...iv, startsAt: input.startsAt, endsAt, meetUrl, sequence: iv.rescheduleCount + 1 },
    "moved",
  );
  await notify(
    db,
    people
      .filter((p) => p.userId)
      .map((p) => ({
        userId: p.userId!,
        kind: "interview_moved",
        title: `${iv.roundName} with ${pinned.candidateName} moved`,
        body: formatIst(input.startsAt),
        link: `/team/interviews/${iv.id}`,
      })),
  );
  await audit(db, {
    actorUserId: actor.userId,
    action: "interview_rescheduled",
    entity: "interview",
    entityId: iv.id,
    before: { startsAt: iv.startsAt.toISOString() },
    after: { startsAt: input.startsAt.toISOString() },
  });
  return { ok: true };
}

export async function cancelInterview(
  db: Db,
  deps: InterviewDeps,
  actor: TeamActor,
  interviewId: string,
): Promise<Result> {
  const loaded = await loadInterview(db, actor, interviewId);
  if (!loaded) return { ok: false, error: "Interview not found." };
  const { iv, pinned } = loaded;
  if (iv.status !== "scheduled")
    return { ok: false, error: "Only upcoming interviews can be cancelled." };
  if (iv.calendarEventId && deps.calendar) await deps.calendar.cancelEvent(iv.calendarEventId);
  await db.update(interviews).set({ status: "cancelled" }).where(eq(interviews.id, iv.id));
  await db
    .update(stageProgress)
    .set({ state: "unlocked" })
    .where(eq(stageProgress.id, iv.stageProgressId));
  await db
    .update(applications)
    .set({ status: "active" })
    .where(eq(applications.id, iv.applicationId));
  await emailCandidate(deps, pinned, { ...iv, sequence: iv.rescheduleCount + 1 }, "cancelled");
  await audit(db, {
    actorUserId: actor.userId,
    action: "interview_cancelled",
    entity: "interview",
    entityId: iv.id,
  });
  return { ok: true };
}

/** After the call: done moves the candidate on along the stage's rules; no-show asks for a decision. */
export async function recordInterviewOutcome(
  db: Db,
  deps: InterviewDeps,
  actor: TeamActor,
  interviewId: string,
  outcome: "done" | "no_show",
): Promise<Result> {
  const loaded = await loadInterview(db, actor, interviewId);
  if (!loaded) return { ok: false, error: "Interview not found." };
  const { iv, pinned } = loaded;
  if (iv.status !== "scheduled") return { ok: false, error: "Already recorded." };
  const now = deps.now?.() ?? new Date();
  if (iv.startsAt > now) return { ok: false, error: "The interview hasn't started yet." };
  await db.update(interviews).set({ status: outcome }).where(eq(interviews.id, iv.id));
  if (outcome === "done") {
    await db
      .update(stageProgress)
      .set({ state: "submitted", submittedAt: now })
      .where(eq(stageProgress.id, iv.stageProgressId));
    await db
      .update(applications)
      .set({ status: "active" })
      .where(eq(applications.id, iv.applicationId));
    const ctx = await buildRuleContext(db, pinned, iv.nodeId);
    await advanceFrom(db, deps, iv.applicationId, iv.nodeId, ctx, "system");
  } else {
    await db
      .update(stageProgress)
      .set({ state: "missed" })
      .where(eq(stageProgress.id, iv.stageProgressId));
    await db
      .update(applications)
      .set({ status: "needs_decision" })
      .where(eq(applications.id, iv.applicationId));
    await notifyAdmins(db, pinned, {
      kind: "interview_no_show",
      title: `${pinned.candidateName} missed the ${iv.roundName}`,
      body: "Offer a new time or decide from the pipeline.",
      link: `/team/interviews`,
    });
  }
  await audit(db, {
    actorUserId: actor.userId,
    action: `interview_${outcome}`,
    entity: "interview",
    entityId: iv.id,
  });
  return { ok: true };
}

/** 24 hours and 1 hour before: email the candidate, ping the panel in-app. */
export async function sendInterviewReminders(db: Db, deps: InterviewDeps) {
  const now = deps.now?.() ?? new Date();
  let sent = 0;
  for (const [field, ahead] of [
    ["reminderDaySentAt", 24 * 3600_000],
    ["reminderHourSentAt", 3600_000],
  ] as const) {
    const due = await db
      .select()
      .from(interviews)
      .where(
        and(
          eq(interviews.status, "scheduled"),
          isNull(interviews[field]),
          gt(interviews.startsAt, now),
          lte(interviews.startsAt, new Date(now.getTime() + ahead)),
        ),
      );
    for (const iv of due) {
      // Booked inside the window: the invite itself was the reminder for the day-before one.
      if (field === "reminderDaySentAt" && iv.createdAt.getTime() > iv.startsAt.getTime() - ahead) {
        await db
          .update(interviews)
          .set({ [field]: now })
          .where(eq(interviews.id, iv.id));
        continue;
      }
      const pinned = await loadPinned(db, iv.applicationId);
      await deps.queueEmail({
        to: pinned.email,
        templateKey: "interview_reminder",
        userId: pinned.userId,
        applicationId: iv.applicationId,
        vars: {
          first_name: firstName(pinned.candidateName),
          role: pinned.roleTitle,
          round: iv.roundName,
          when: formatIst(iv.startsAt),
          where: where(iv.mode, iv.meetUrl, iv.location),
        },
      });
      const people = await panel(db, iv.interviewerIds);
      await notify(
        db,
        people
          .filter((p) => p.userId)
          .map((p) => ({
            userId: p.userId!,
            kind: "interview_soon",
            title: `${iv.roundName} with ${pinned.candidateName} ${field === "reminderHourSentAt" ? "in an hour" : "tomorrow"}`,
            link: `/team/interviews/${iv.id}`,
          })),
      );
      await db
        .update(interviews)
        .set({ [field]: now })
        .where(eq(interviews.id, iv.id));
      sent++;
    }
  }
  return sent;
}

// ─── Reading ─────────────────────────────────────────────────────────────────

type Field = { label: string; value: string; fileId?: string };

/** A submission as label → value pairs, using the stage's own field labels. */
function labelledFields(
  node: PinnedApplication["config"]["nodes"][number] | undefined,
  data: Record<string, unknown> | null,
  fileNames: Map<string, string>,
): Field[] {
  if (!node || !data) return [];
  const defs =
    node.type === "task"
      ? taskSubmissionFields(node.config)
      : node.type === "form" || node.type === "custom"
        ? node.config.fields
            .filter((f) => f.kind !== "section")
            .map((f) => ({ id: f.id, label: f.label, file: f.kind === "file" }))
        : [];
  return defs.flatMap((d) => {
    const v = data[d.id];
    if (v === null || v === undefined || v === "") return [];
    const text = Array.isArray(v) ? v.join(", ") : String(v);
    return d.file
      ? [{ label: d.label, value: fileNames.get(text) ?? "File", fileId: text }]
      : [{ label: d.label, value: text }];
  });
}

const interviewerUserIds = async (db: Db, memberIds: string[]) =>
  (await panel(db, memberIds)).flatMap((p) => (p.userId ? [p.userId] : []));

/** Interviews page: who's ready to book, what's coming up, and recent ones needing an outcome. */
export async function interviewBoard(db: Db, actor: TeamActor) {
  const manages = actor.role === "admin" || actor.role === "hiring_manager";
  const ready: {
    applicationId: string;
    candidateName: string;
    roleTitle: string;
    roundName: string;
    durationMin: number;
    mode: string;
    pool: string[];
    waitingSince: Date;
  }[] = [];
  if (manages) {
    const rows = await db
      .select({ app: applications, name: candidates.name, p: stageProgress })
      .from(applications)
      .innerJoin(candidates, eq(candidates.id, applications.candidateId))
      .innerJoin(
        stageProgress,
        and(
          eq(stageProgress.applicationId, applications.id),
          eq(stageProgress.nodeId, applications.currentNodeId),
        ),
      )
      .where(and(eq(applications.status, "active"), eq(stageProgress.state, "unlocked")));
    for (const r of rows) {
      if (
        !can(actor, "write", {
          type: "workflow",
          roleId: r.app.roleId,
          workflowId: r.app.workflowId,
        })
      )
        continue;
      const pinned = await loadPinned(db, r.app.id);
      const node = interviewNode(pinned, r.app.currentNodeId);
      if (!node) continue;
      ready.push({
        applicationId: r.app.id,
        candidateName: r.name,
        roleTitle: pinned.roleTitle,
        roundName: node.config.roundName,
        durationMin: node.config.durationMin,
        mode: node.config.mode,
        pool: node.config.interviewerPool,
        waitingSince: r.p.unlockedAt,
      });
    }
  }
  const all = await db
    .select({
      iv: interviews,
      name: candidates.name,
      roleId: applications.roleId,
      workflowId: applications.workflowId,
    })
    .from(interviews)
    .innerJoin(applications, eq(applications.id, interviews.applicationId))
    .innerJoin(candidates, eq(candidates.id, applications.candidateId))
    .where(inArray(interviews.status, ["scheduled", "done", "no_show"]))
    .orderBy(asc(interviews.startsAt))
    .limit(500);
  const members = await db
    .select({ id: teamMembers.id, email: teamMembers.email, userId: teamMembers.userId })
    .from(teamMembers);
  const visible = all.filter((r) =>
    can(actor, "read", {
      type: "interview",
      roleId: r.roleId,
      interviewerIds: r.iv.interviewerIds.flatMap(
        (m) => members.find((x) => x.id === m)?.userId ?? [],
      ),
    }),
  );
  const shape = (r: (typeof visible)[number]) => ({
    ...r.iv,
    candidateName: r.name,
    panel: r.iv.interviewerIds.map((m) => members.find((x) => x.id === m)?.email ?? "?"),
  });
  return {
    ready,
    upcoming: visible.filter((r) => r.iv.status === "scheduled").map(shape),
    past: visible
      .filter((r) => r.iv.status !== "scheduled")
      .reverse()
      .slice(0, 30)
      .map(shape),
  };
}

/** The private brief linked from the calendar event: snapshot, scores, reviewer notes. */
export async function getInterviewBrief(db: Db, actor: TeamActor, interviewId: string) {
  const [iv] = await db.select().from(interviews).where(eq(interviews.id, interviewId));
  if (!iv) return null;
  const pinned = await loadPinned(db, iv.applicationId);
  const allowed = can(actor, "read", {
    type: "interview",
    roleId: pinned.app.roleId,
    interviewerIds: await interviewerUserIds(db, iv.interviewerIds),
  });
  if (!allowed) return null;
  const [cand] = await db
    .select({ c: candidates, email: users.email })
    .from(candidates)
    .innerJoin(users, eq(users.id, candidates.userId))
    .where(eq(candidates.id, pinned.app.candidateId));
  const scores = await stageScores(db, pinned);
  const progress = await db
    .select()
    .from(stageProgress)
    .where(eq(stageProgress.applicationId, pinned.app.id));
  const stages = pinned.config.nodes
    .map((n) => {
      const p = progress.find((x) => x.nodeId === n.id);
      return p
        ? {
            nodeId: n.id,
            title: n.title,
            type: n.type,
            state: p.state,
            pct: scores[n.id] ?? null,
            progressId: p.id,
          }
        : null;
    })
    .filter((s) => s !== null);
  const reviewRows = progress.length
    ? await db
        .select({ r: reviews, reviewer: teamMembers.email })
        .from(reviews)
        .leftJoin(teamMembers, eq(teamMembers.id, reviews.reviewerId))
        .where(
          and(
            inArray(
              reviews.stageProgressId,
              progress.map((p) => p.id),
            ),
            eq(reviews.kind, "human"),
          ),
        )
        .orderBy(desc(reviews.submittedAt))
    : [];
  const subs = progress.length
    ? await db
        .select()
        .from(submissions)
        .where(
          inArray(
            submissions.stageProgressId,
            progress.map((p) => p.id),
          ),
        )
        .orderBy(desc(submissions.version))
    : [];
  const fileIds = subs.flatMap((x) => x.fileIds);
  const fileNames = new Map(
    (fileIds.length
      ? await db
          .select({ id: files.id, filename: files.filename })
          .from(files)
          .where(inArray(files.id, fileIds))
      : []
    ).map((f) => [f.id, f.filename]),
  );
  const people = await panel(db, iv.interviewerIds);
  return {
    interview: iv,
    panel: people.map((p) => p.email),
    roleTitle: pinned.roleTitle,
    candidate: { ...cand!.c, email: cand!.email },
    composite: (await buildRuleContext(db, pinned, iv.nodeId).catch(() => null))?.composite ?? null,
    stages: stages.map((s) => ({
      ...s,
      reviews: reviewRows
        .filter((r) => r.r.stageProgressId === s.progressId)
        .map((r) => ({
          reviewer: r.reviewer,
          pct: r.r.totalPct,
          recommendation: r.r.recommendation,
          notes: r.r.notes,
        })),
      fields: labelledFields(
        pinned.config.nodes.find((n) => n.id === s.nodeId),
        (subs.find((x) => x.stageProgressId === s.progressId)?.data ?? null) as Record<
          string,
          unknown
        > | null,
        fileNames,
      ),
    })),
    canManage: can(actor, "write", {
      type: "workflow",
      roleId: pinned.app.roleId,
      workflowId: pinned.app.workflowId,
    }),
  };
}

/** For the schedule dialog: who's on the stage's pool, plus everyone else who can interview. */
export async function interviewerOptions(db: Db) {
  return db
    .select({ id: teamMembers.id, email: teamMembers.email, role: teamMembers.role })
    .from(teamMembers)
    .where(eq(teamMembers.active, true))
    .orderBy(teamMembers.email);
}

/** Free/busy for the schedule dialog's availability check. */
export async function checkAvailability(
  db: Db,
  deps: InterviewDeps,
  input: {
    interviewerIds: string[];
    startsAt: Date;
    durationMin: number;
    exceptInterviewId?: string;
  },
) {
  const people = await panel(db, input.interviewerIds);
  const end = new Date(input.startsAt.getTime() + input.durationMin * 60_000);
  return findConflicts(db, deps, people, input.startsAt, end, input.exceptInterviewId);
}

/** The candidate's own view of a booked interview. Call only after the stage access check. */
export async function candidateInterview(db: Db, applicationId: string, nodeId: string) {
  const [iv] = await db
    .select({
      roundName: interviews.roundName,
      startsAt: interviews.startsAt,
      endsAt: interviews.endsAt,
      mode: interviews.mode,
      meetUrl: interviews.meetUrl,
      location: interviews.location,
      status: interviews.status,
    })
    .from(interviews)
    .where(
      and(
        eq(interviews.applicationId, applicationId),
        eq(interviews.nodeId, nodeId),
        inArray(interviews.status, ["scheduled", "done"]),
      ),
    )
    .orderBy(desc(interviews.startsAt))
    .limit(1);
  return iv ?? null;
}
