import { seededShuffle } from "../engine/shuffle";
import type { NodeOf } from "./schema";

type TaskConfig = NodeOf<"task">["config"];
export type ProblemStatement = NonNullable<TaskConfig["problemStatements"]>["items"][number];

/** Submission keys the chosen statement is saved under, next to the deliverables. */
export const PROBLEM_ID_KEY = "problem_statement_id";
export const PROBLEM_KEY = "problem_statement";

/** The statements this candidate chooses from: a random `offer` of the pool, stable per seed. */
export function offeredProblemStatements(config: TaskConfig, seed: string): ProblemStatement[] {
  const ps = config.problemStatements;
  if (!ps?.items.length) return [];
  return seededShuffle(ps.items, seed).slice(0, ps.offer);
}

/** The full text saved with a submission, so reviewers read exactly what the candidate picked. */
export const problemStatementText = (p: ProblemStatement) =>
  p.body ? `${p.title}\n\n${p.body}` : p.title;

/** A task submission's fields in display order: the chosen statement first, then deliverables. */
export function taskSubmissionFields(config: TaskConfig) {
  const deliverables = config.deliverables.map((d) => ({
    id: d.id,
    label: d.label,
    file: d.kind === "file",
  }));
  return config.problemStatements?.items.length
    ? [{ id: PROBLEM_KEY, label: "Problem statement", file: false }, ...deliverables]
    : deliverables;
}
