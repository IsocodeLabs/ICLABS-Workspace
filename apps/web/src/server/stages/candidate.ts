import {
  and,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  assessmentSessions,
  integrityEvents,
  questions,
  stageProgress,
  submissions,
  type Db,
} from "@iclabs/db";
import {
  autoScore,
  can,
  offeredProblemStatements,
  problemStatementText,
  PROBLEM_ID_KEY,
  PROBLEM_KEY,
  seededShuffle,
  validateFormAnswers,
  type Actor,
  type NodeOf,
  type NodeState,
  type WorkflowNode,
} from "@iclabs/core";
import { ownCleanFiles } from "../storage/files";
import { completeSubmission, loadPinned, type ProgressionDeps } from "./progression";

type CandidateActor = Extract<Actor, { kind: "candidate" }>;

const NODE_STATE: Record<string, NodeState> = {
  unlocked: "unlocked",
  in_progress: "in_progress",
  submitted: "submitted",
  reviewed: "reviewed",
  passed: "passed",
  failed: "failed",
  missed: "failed",
  skipped: "skipped",
};

/** Loads a stage only if the policy lets this candidate see it; otherwise null (→ 404). */
async function loadStage(db: Db, actor: CandidateActor, applicationId: string, nodeId: string) {
  let pinned;
  try {
    pinned = await loadPinned(db, applicationId);
  } catch {
    return null;
  }
  if (pinned.app.candidateId !== actor.candidateId) return null;
  const node = pinned.config.nodes.find((n) => n.id === nodeId);
  const [progress] = await db
    .select()
    .from(stageProgress)
    .where(and(eq(stageProgress.applicationId, applicationId), eq(stageProgress.nodeId, nodeId)));
  if (!node || !progress || node.visibility !== "candidate") return null;
  const resource = {
    type: "stage" as const,
    candidateId: pinned.app.candidateId,
    roleId: pinned.app.roleId,
    workflowId: pinned.app.workflowId,
    applicationStatus: pinned.app.status,
    nodeState: NODE_STATE[progress.state] ?? "locked",
  };
  if (!can(actor, "read", resource)) return null;
  return { pinned, node, progress, canSubmit: can(actor, "submit", resource) };
}

/** Closing time that actually applies: an extension, else deadline + grace. */
function closesAt(p: typeof stageProgress.$inferSelect): Date | null {
  return p.extendedUntil ?? p.graceUntil ?? p.dueAt;
}

export type StageView = NonNullable<Awaited<ReturnType<typeof getCandidateStage>>>;

/** What the candidate sees for a stage. Never includes answer keys or reviewer data. */
export async function getCandidateStage(
  db: Db,
  actor: CandidateActor,
  applicationId: string,
  nodeId: string,
  now = new Date(),
) {
  const s = await loadStage(db, actor, applicationId, nodeId);
  if (!s) return null;
  const close = closesAt(s.progress);
  const [latest] = await db
    .select()
    .from(submissions)
    .where(eq(submissions.stageProgressId, s.progress.id))
    .orderBy(desc(submissions.version))
    .limit(1);
  const [session] =
    s.node.type === "assessment"
      ? await db
          .select()
          .from(assessmentSessions)
          .where(eq(assessmentSessions.stageProgressId, s.progress.id))
      : [];
  return {
    roleTitle: s.pinned.roleTitle,
    applicationId,
    node: publicNode(s.node, s.progress.id),
    state: s.progress.state,
    dueAt: s.progress.dueAt,
    closesAt: close,
    closed: !!close && now > close,
    canSubmit: s.canSubmit && (!close || now <= close),
    draft: s.progress.draft ?? {},
    lastSubmission: latest
      ? {
          version: latest.version,
          data: latest.data,
          submittedAt: latest.submittedAt,
          isLate: latest.isLate,
        }
      : null,
    session: session
      ? {
          id: session.id,
          endsAt: session.endsAt,
          submittedAt: session.submittedAt,
          questionCount: session.questionIds.length,
        }
      : null,
  };
}

/**
 * Strips everything a candidate shouldn't see (reviewer setup, rubric, rules, email keys, and
 * problem statements outside the ones offered to them). `seed` is their stage progress id.
 */
function publicNode(node: WorkflowNode, seed: string) {
  const base = {
    id: node.id,
    type: node.type,
    title: node.title,
    description: node.description ?? null,
  };
  switch (node.type) {
    case "form":
      return { ...base, fields: node.config.fields };
    case "custom":
      return { ...base, fields: node.config.fields, timerMin: node.config.timerMin ?? null };
    case "task":
      return {
        ...base,
        brief: node.config.brief,
        deliverables: node.config.deliverables,
        allowResubmit: node.config.allowResubmit,
        problemStatements: offeredProblemStatements(node.config, seed),
      };
    case "assessment":
      return {
        ...base,
        durationMin: node.config.durationMin,
        questionCount:
          node.config.questions.fixed.length +
          node.config.questions.draw.reduce((n, d) => n + d.count, 0),
      };
    case "interview":
      return {
        ...base,
        roundName: node.config.roundName,
        durationMin: node.config.durationMin,
        mode: node.config.mode,
      };
    default:
      return base;
  }
}

export async function saveStageDraft(
  db: Db,
  actor: CandidateActor,
  applicationId: string,
  nodeId: string,
  draft: Record<string, unknown>,
) {
  const s = await loadStage(db, actor, applicationId, nodeId);
  if (!s?.canSubmit) return { ok: false as const };
  if (JSON.stringify(draft).length > 200_000) return { ok: false as const };
  await db
    .update(stageProgress)
    .set({ draft, state: s.progress.state === "unlocked" ? "in_progress" : s.progress.state })
    .where(eq(stageProgress.id, s.progress.id));
  return { ok: true as const };
}

type SubmitResult =
  { ok: true; late: boolean } | { ok: false; error: string; fieldErrors?: Record<string, string> };

function lateness(p: typeof stageProgress.$inferSelect, now: Date) {
  const close = closesAt(p);
  if (close && now > close) return { closed: true, late: true, minutes: 0 };
  const late = !!p.dueAt && now > p.dueAt && !p.extendedUntil;
  return {
    closed: false,
    late,
    minutes: late ? Math.ceil((now.getTime() - p.dueAt!.getTime()) / 60_000) : 0,
  };
}

/** Form and custom-step submissions. */
export async function submitForm(
  db: Db,
  deps: ProgressionDeps,
  actor: CandidateActor,
  applicationId: string,
  nodeId: string,
  answers: Record<string, unknown>,
): Promise<SubmitResult> {
  const now = deps.now?.() ?? new Date();
  const s = await loadStage(db, actor, applicationId, nodeId);
  if (!s?.canSubmit || (s.node.type !== "form" && s.node.type !== "custom"))
    return { ok: false, error: "This step isn't open." };
  const timing = lateness(s.progress, now);
  if (timing.closed) return { ok: false, error: "The deadline has passed." };

  const fields = s.node.config.fields;
  const fieldErrors: Record<string, string> = validateFormAnswers(fields, answers);
  const fileFieldIds = fields.filter((f) => f.kind === "file").map((f) => f.id);
  const claimed = fileFieldIds.flatMap((id) => (answers[id] ? [String(answers[id])] : []));
  const okFiles = new Set((await ownCleanFiles(db, actor, claimed)).map((f) => f.id));
  for (const id of fileFieldIds) {
    const v = answers[id];
    if (v && !okFiles.has(String(v))) fieldErrors[id] = "file";
    if (!v && fields.find((f) => f.id === id)?.required) fieldErrors[id] = "required";
  }
  if (Object.keys(fieldErrors).length)
    return { ok: false, error: "Check the highlighted answers.", fieldErrors };

  const clean = Object.fromEntries(
    fields.filter((f) => f.kind !== "section").map((f) => [f.id, answers[f.id] ?? null]),
  );
  await recordSubmission(db, s.progress.id, clean, [...okFiles], timing, now);
  await afterSubmit(db, deps, s, { answers: stringAnswers(clean), late: timing.late });
  return { ok: true, late: timing.late };
}

/** Task deliverables: links, text and uploaded files. Resubmission keeps every version. */
export async function submitTask(
  db: Db,
  deps: ProgressionDeps,
  actor: CandidateActor,
  applicationId: string,
  nodeId: string,
  deliverables: Record<string, string>,
): Promise<SubmitResult> {
  const now = deps.now?.() ?? new Date();
  const s = await loadStage(db, actor, applicationId, nodeId);
  if (!s || s.node.type !== "task") return { ok: false, error: "This step isn't open." };
  const resubmitting = s.progress.state === "submitted";
  if (!(s.canSubmit || (resubmitting && s.node.config.allowResubmit)))
    return { ok: false, error: "This step isn't open." };
  const timing = lateness(s.progress, now);
  if (timing.closed) return { ok: false, error: "The deadline has passed." };

  const fieldErrors: Record<string, string> = {};
  // The chosen statement is resolved from the pool here, never taken from candidate text.
  const data: Record<string, string> = { ...deliverables };
  delete data[PROBLEM_ID_KEY];
  delete data[PROBLEM_KEY];
  const offered = offeredProblemStatements(s.node.config, s.progress.id);
  if (offered.length) {
    const picked = offered.find((p) => p.id === deliverables[PROBLEM_ID_KEY]);
    if (picked) {
      data[PROBLEM_ID_KEY] = picked.id;
      data[PROBLEM_KEY] = problemStatementText(picked);
    } else fieldErrors[PROBLEM_ID_KEY] = "required";
  }
  const fileIds: string[] = [];
  for (const d of s.node.config.deliverables) {
    const v = deliverables[d.id]?.trim() ?? "";
    if (!v) {
      if (d.required) fieldErrors[d.id] = "required";
      continue;
    }
    if (d.kind === "link") {
      const err = validateFormAnswers(
        [
          {
            id: d.id,
            label: d.label,
            kind: "url",
            required: true,
            allowedDomains: d.allowedDomains,
          },
        ],
        { [d.id]: v },
      );
      if (err[d.id]) fieldErrors[d.id] = err[d.id]!;
    } else if (d.kind === "file") {
      fileIds.push(v);
    } else if (v.length > 20_000) fieldErrors[d.id] = "too_long";
  }
  const okFiles = new Set((await ownCleanFiles(db, actor, fileIds)).map((f) => f.id));
  for (const d of s.node.config.deliverables) {
    if (d.kind === "file" && deliverables[d.id] && !okFiles.has(deliverables[d.id]!))
      fieldErrors[d.id] = "file";
  }
  if (Object.keys(fieldErrors).length)
    return { ok: false, error: "Check the highlighted deliverables.", fieldErrors };

  await recordSubmission(db, s.progress.id, data, [...okFiles], timing, now);
  if (!resubmitting) await afterSubmit(db, deps, s, { answers: {}, late: timing.late });
  return { ok: true, late: timing.late };
}

async function recordSubmission(
  db: Db,
  progressId: string,
  data: Record<string, unknown>,
  fileIds: string[],
  timing: { late: boolean; minutes: number },
  now: Date,
) {
  const [last] = await db
    .select({ version: submissions.version })
    .from(submissions)
    .where(eq(submissions.stageProgressId, progressId))
    .orderBy(desc(submissions.version))
    .limit(1);
  await db.insert(submissions).values({
    stageProgressId: progressId,
    version: (last?.version ?? 0) + 1,
    data,
    fileIds,
    submittedAt: now,
    isLate: timing.late,
    lateByMinutes: timing.late ? timing.minutes : null,
  });
  await db
    .update(stageProgress)
    .set({ state: "submitted", submittedAt: now, draft: null })
    .where(eq(stageProgress.id, progressId));
}

async function afterSubmit(
  db: Db,
  deps: ProgressionDeps,
  s: NonNullable<Awaited<ReturnType<typeof loadStage>>>,
  ctx: {
    answers: Record<string, string | string[]>;
    late: boolean;
    autoScorePct?: number | null;
    hasWrittenAnswers?: boolean;
  },
) {
  await deps.queueEmail({
    to: s.pinned.email,
    templateKey: "submission_received",
    userId: s.pinned.userId,
    applicationId: s.pinned.app.id,
    vars: {
      first_name: s.pinned.candidateName.split(" ")[0]!,
      role: s.pinned.roleTitle,
      stage: s.node.title,
    },
  });
  await completeSubmission(db, deps, s.pinned.app.id, s.node, {
    answers: ctx.answers,
    autoScorePct: ctx.autoScorePct,
    hasWrittenAnswers: ctx.hasWrittenAnswers,
    flags: { late: ctx.late, integrityHigh: false },
  });
}

const stringAnswers = (data: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(data)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k, v]) => [k, Array.isArray(v) ? v.map(String) : String(v)]),
  ) as Record<string, string | string[]>;

// ─── Timed assessments ───────────────────────────────────────────────────────

/** Picks this candidate's questions: fixed ones plus random draws by tag, all approved. */
async function pickQuestions(db: Db, node: NodeOf<"assessment">, seed: string): Promise<string[]> {
  const approved = await db
    .select({ id: questions.id, tags: questions.tags, difficulty: questions.difficulty })
    .from(questions)
    .where(eq(questions.status, "approved"));
  const approvedIds = new Set(approved.map((q) => q.id));
  const chosen = node.config.questions.fixed.filter((id) => approvedIds.has(id));
  node.config.questions.draw.forEach((draw, i) => {
    const pool = approved.filter(
      (q) =>
        !chosen.includes(q.id) &&
        draw.tags.some((t) => q.tags.includes(t.toLowerCase())) &&
        (!draw.difficulty || q.difficulty === draw.difficulty),
    );
    chosen.push(
      ...seededShuffle(
        pool.map((q) => q.id),
        `${seed}:${i}`,
      ).slice(0, draw.count),
    );
  });
  return node.config.shuffleQuestions ? seededShuffle(chosen, `${seed}:order`) : chosen;
}

/** Starts (or resumes) the timed attempt. The server clock is authoritative. */
export async function startAssessment(
  db: Db,
  actor: CandidateActor,
  applicationId: string,
  nodeId: string,
  now = new Date(),
) {
  const s = await loadStage(db, actor, applicationId, nodeId);
  if (!s || s.node.type !== "assessment")
    return { ok: false as const, error: "This step isn't open." };
  const [existing] = await db
    .select()
    .from(assessmentSessions)
    .where(eq(assessmentSessions.stageProgressId, s.progress.id));
  if (existing) return { ok: true as const, sessionId: existing.id, endsAt: existing.endsAt };
  if (!s.canSubmit) return { ok: false as const, error: "This step isn't open." };
  const close = closesAt(s.progress);
  if (close && now > close) return { ok: false as const, error: "The deadline has passed." };
  const window = s.node.config.window;
  if (window && (now < new Date(window.opens) || now > new Date(window.closes))) {
    return { ok: false as const, error: "This assessment isn't open right now." };
  }

  const questionIds = await pickQuestions(db, s.node, `${applicationId}:${nodeId}`);
  if (questionIds.length === 0)
    return { ok: false as const, error: "This assessment isn't ready yet. Please contact us." };
  let endsAt = new Date(now.getTime() + s.node.config.durationMin * 60_000);
  if (window && new Date(window.closes) < endsAt) endsAt = new Date(window.closes);
  const [session] = await db
    .insert(assessmentSessions)
    .values({ stageProgressId: s.progress.id, questionIds, startedAt: now, endsAt })
    .onConflictDoNothing()
    .returning();
  await db
    .update(stageProgress)
    .set({ state: "in_progress" })
    .where(eq(stageProgress.id, s.progress.id));
  return { ok: true as const, sessionId: session!.id, endsAt };
}

/** Questions for an active attempt, without answer keys; option order is stable per candidate. */
export async function getAssessmentQuestions(
  db: Db,
  actor: CandidateActor,
  applicationId: string,
  nodeId: string,
) {
  const s = await loadStage(db, actor, applicationId, nodeId);
  if (!s || s.node.type !== "assessment") return null;
  const [session] = await db
    .select()
    .from(assessmentSessions)
    .where(eq(assessmentSessions.stageProgressId, s.progress.id));
  if (!session) return null;
  const rows = await db
    .select({
      id: questions.id,
      type: questions.type,
      body: questions.body,
      options: questions.options,
    })
    .from(questions)
    .where(inArray(questions.id, session.questionIds));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const shuffleOptions = s.node.config.shuffleOptions;
  return {
    sessionId: session.id,
    endsAt: session.endsAt,
    submitted: !!session.submittedAt,
    answers: session.answers,
    questions: session.questionIds
      .map((id) => byId.get(id))
      .filter((q) => q !== undefined)
      .map((q) => ({
        ...q,
        options: shuffleOptions ? seededShuffle(q.options, `${session.id}:${q.id}`) : q.options,
      })),
  };
}

const GRACE_MS = 5_000;

export async function saveAnswer(
  db: Db,
  actor: CandidateActor,
  applicationId: string,
  nodeId: string,
  questionId: string,
  value: string | string[],
  now = new Date(),
) {
  const s = await loadStage(db, actor, applicationId, nodeId);
  if (!s) return { ok: false as const, error: "not_found" };
  const [session] = await db
    .select()
    .from(assessmentSessions)
    .where(eq(assessmentSessions.stageProgressId, s.progress.id));
  if (!session || session.submittedAt) return { ok: false as const, error: "closed" };
  if (now.getTime() > session.endsAt.getTime() + GRACE_MS)
    return { ok: false as const, error: "time_up" };
  if (!session.questionIds.includes(questionId)) return { ok: false as const, error: "not_found" };
  const clean = Array.isArray(value)
    ? value.slice(0, 20).map((v) => String(v).slice(0, 100))
    : String(value).slice(0, 10_000);
  await db
    .update(assessmentSessions)
    .set({ answers: { ...session.answers, [questionId]: clean } })
    .where(eq(assessmentSessions.id, session.id));
  return { ok: true as const };
}

/** Submits an attempt (by the candidate, or automatically when time runs out). */
export async function submitAssessment(
  db: Db,
  deps: ProgressionDeps,
  sessionId: string,
  opts: { actor?: CandidateActor; auto?: boolean } = {},
) {
  const now = deps.now?.() ?? new Date();
  const [session] = await db
    .select()
    .from(assessmentSessions)
    .where(eq(assessmentSessions.id, sessionId));
  if (!session) return { ok: false as const, error: "not_found" };
  const [progress] = await db
    .select()
    .from(stageProgress)
    .where(eq(stageProgress.id, session.stageProgressId));
  const pinned = await loadPinned(db, progress!.applicationId);
  if (opts.actor && pinned.app.candidateId !== opts.actor.candidateId)
    return { ok: false as const, error: "not_found" };

  const [claimed] = await db
    .update(assessmentSessions)
    .set({ submittedAt: now, autoSubmitted: !!opts.auto })
    .where(and(eq(assessmentSessions.id, sessionId), isNull(assessmentSessions.submittedAt)))
    .returning();
  if (!claimed) return { ok: true as const, already: true };

  const qs = await db
    .select({
      id: questions.id,
      type: questions.type,
      points: questions.points,
      correct: questions.correct,
    })
    .from(questions)
    .where(inArray(questions.id, session.questionIds));
  const score = autoScore(qs, session.answers);
  const late = !!progress!.dueAt && now > progress!.dueAt;
  await db.insert(submissions).values({
    stageProgressId: progress!.id,
    version: 1,
    data: { answers: session.answers, autoSubmitted: !!opts.auto, score },
    submittedAt: now,
    isLate: late,
  });
  await db
    .update(stageProgress)
    .set({ state: "submitted", submittedAt: now, autoScorePct: score.pct })
    .where(eq(stageProgress.id, progress!.id));

  const node = pinned.config.nodes.find((n) => n.id === progress!.nodeId)!;
  await afterSubmit(
    db,
    deps,
    { pinned, node, progress: progress!, canSubmit: false },
    {
      answers: {},
      late,
      autoScorePct: score.pct,
      hasWrittenAnswers: score.needsReview,
    },
  );
  return { ok: true as const, already: false };
}

/** Cloud Scheduler, every minute: submit attempts whose time ran out. */
export async function sweepExpiredAssessments(db: Db, deps: ProgressionDeps) {
  const now = deps.now?.() ?? new Date();
  const expired = await db
    .select({ id: assessmentSessions.id })
    .from(assessmentSessions)
    .where(
      and(
        isNull(assessmentSessions.submittedAt),
        lt(assessmentSessions.endsAt, new Date(now.getTime() - GRACE_MS)),
      ),
    );
  for (const e of expired) await submitAssessment(db, deps, e.id, { auto: true });
  return expired.length;
}

const EVENT_TYPES = new Set([
  "blur",
  "visibility_hidden",
  "fullscreen_exit",
  "paste_attempt",
  "copy_attempt",
]);

/** Signals for reviewers. Never used to auto-penalise. */
export async function recordIntegrity(
  db: Db,
  actor: CandidateActor,
  applicationId: string,
  nodeId: string,
  events: { type: string; at: string; durationMs?: number }[],
) {
  const s = await loadStage(db, actor, applicationId, nodeId);
  if (!s) return;
  const [session] = await db
    .select()
    .from(assessmentSessions)
    .where(eq(assessmentSessions.stageProgressId, s.progress.id));
  if (!session || session.submittedAt) return;
  const rows = events
    .slice(0, 200)
    .filter((e) => EVENT_TYPES.has(e.type) && !Number.isNaN(Date.parse(e.at)))
    .map((e) => ({
      sessionId: session.id,
      type: e.type as (typeof integrityEvents.$inferInsert)["type"],
      at: new Date(e.at),
      durationMs: e.durationMs
        ? Math.min(Math.max(0, Math.round(e.durationMs)), 24 * 3600_000)
        : null,
    }));
  if (rows.length) await db.insert(integrityEvents).values(rows);
}

export async function integritySummary(db: Db, sessionId: string) {
  const rows = await db
    .select()
    .from(integrityEvents)
    .where(eq(integrityEvents.sessionId, sessionId));
  const count = (t: string) => rows.filter((r) => r.type === t).length;
  const awayMs = rows
    .filter((r) => r.type === "visibility_hidden" || r.type === "fullscreen_exit")
    .reduce((n, r) => n + (r.durationMs ?? 0), 0);
  return {
    fullscreenExits: count("fullscreen_exit"),
    tabSwitches: count("visibility_hidden") + count("blur"),
    pasteAttempts: count("paste_attempt"),
    copyAttempts: count("copy_attempt"),
    awayMs,
  };
}
