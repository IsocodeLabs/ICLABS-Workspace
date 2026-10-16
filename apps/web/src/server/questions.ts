import { z } from "zod";
import { ulid } from "ulid";
import { desc, eq, questions, type Db } from "@iclabs/db";
import type { Actor } from "@iclabs/core";
import { ForbiddenError, audit } from "./audit";

function assertAuthor(actor: Actor) {
  if (
    actor.kind !== "team" ||
    !actor.active ||
    (actor.role !== "admin" && actor.role !== "hiring_manager")
  ) {
    throw new ForbiddenError("question bank");
  }
}

export const questionInput = z
  .object({
    type: z.enum(["mcq", "multi", "short", "long"]),
    body: z.string().trim().min(5).max(5000),
    options: z
      .array(
        z.object({
          id: z.string().optional(),
          text: z.string().trim().min(1).max(500),
          correct: z.boolean(),
        }),
      )
      .max(10),
    explanation: z.string().trim().max(2000).optional(),
    tags: z.string().max(300),
    difficulty: z.enum(["easy", "medium", "hard"]),
    points: z.coerce.number().int().min(1).max(20),
  })
  .superRefine((q, ctx) => {
    const objective = q.type === "mcq" || q.type === "multi";
    const correct = q.options.filter((o) => o.correct).length;
    if (objective && q.options.length < 2)
      ctx.addIssue({ code: "custom", message: "Add at least two options." });
    if (q.type === "mcq" && correct !== 1)
      ctx.addIssue({ code: "custom", message: "Mark exactly one correct option." });
    if (q.type === "multi" && correct < 1)
      ctx.addIssue({ code: "custom", message: "Mark at least one correct option." });
  });

export type QuestionInput = z.infer<typeof questionInput>;

const normaliseTags = (tags: string) =>
  [
    ...new Set(
      tags
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
    ),
  ].slice(0, 15);

function toRow(input: QuestionInput) {
  const objective = input.type === "mcq" || input.type === "multi";
  const options = objective
    ? input.options.map((o) => ({ id: o.id || ulid(), text: o.text, correct: o.correct }))
    : [];
  return {
    type: input.type,
    body: input.body,
    options: options.map(({ id, text }) => ({ id, text })),
    correct: options.filter((o) => o.correct).map((o) => o.id),
    explanation: input.explanation || null,
    tags: normaliseTags(input.tags),
    difficulty: input.difficulty,
    points: input.points,
  };
}

/** New questions start as drafts; only admins approve them into live assessments. */
export async function createQuestion(
  db: Db,
  actor: Actor,
  input: unknown,
  source: "human" | "claude" = "human",
) {
  assertAuthor(actor);
  const parsed = questionInput.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]!.message };
  const [row] = await db
    .insert(questions)
    .values({ ...toRow(parsed.data), status: "draft", source, createdBy: actor.userId })
    .returning({ id: questions.id });
  await audit(db, {
    actorUserId: actor.userId,
    via: source === "claude" ? "mcp" : "ui",
    action: "question_created",
    entity: "question",
    entityId: row!.id,
  });
  return { ok: true as const, id: row!.id };
}

/** Editing an approved question sends it back to draft so changes get a second look. */
export async function updateQuestion(db: Db, actor: Actor, id: string, input: unknown) {
  assertAuthor(actor);
  const parsed = questionInput.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]!.message };
  await db
    .update(questions)
    .set({ ...toRow(parsed.data), status: "draft", approvedBy: null })
    .where(eq(questions.id, id));
  await audit(db, {
    actorUserId: actor.userId,
    action: "question_updated",
    entity: "question",
    entityId: id,
  });
  return { ok: true as const };
}

export async function setQuestionStatus(
  db: Db,
  actor: Actor,
  id: string,
  status: "approved" | "archived" | "draft",
) {
  if (actor.kind !== "team" || actor.role !== "admin" || !actor.active)
    throw new ForbiddenError("approve question");
  await db
    .update(questions)
    .set({ status, approvedBy: status === "approved" ? actor.userId : null })
    .where(eq(questions.id, id));
  await audit(db, {
    actorUserId: actor.userId,
    action: `question_${status}`,
    entity: "question",
    entityId: id,
  });
}

export async function listQuestions(
  db: Db,
  actor: Actor,
  filter: { status?: string; tag?: string; q?: string } = {},
) {
  assertAuthor(actor);
  const rows = await db.select().from(questions).orderBy(desc(questions.createdAt));
  const q = filter.q?.toLowerCase();
  return rows.filter(
    (r) =>
      (!filter.status || r.status === filter.status) &&
      (!filter.tag || r.tags.includes(filter.tag.toLowerCase())) &&
      (!q || r.body.toLowerCase().includes(q)),
  );
}

export async function getQuestion(db: Db, actor: Actor, id: string) {
  assertAuthor(actor);
  const [row] = await db.select().from(questions).where(eq(questions.id, id));
  return row ?? null;
}
