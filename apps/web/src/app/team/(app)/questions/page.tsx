import { EmptyState, Page, PageHeader } from "@/components/admin";
import { db } from "@/server/db";
import { requireTeam } from "@/server/auth/session";
import { listQuestions } from "@/server/questions";
import { QuestionBank } from "./question-bank";

export default async function QuestionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; tag?: string; q?: string }>;
}) {
  const { actor } = await requireTeam(["admin", "hiring_manager"]);
  const filter = await searchParams;
  const rows = await listQuestions(db(), actor, filter);
  return (
    <Page>
      <PageHeader
        title="Question bank"
        subtitle="Assessments draw approved questions by tag. New and edited questions stay drafts until an admin approves them."
      />
      <QuestionBank
        isAdmin={actor.role === "admin"}
        filter={filter}
        questions={rows.map((q) => ({
          id: q.id,
          type: q.type,
          body: q.body,
          options: q.options.map((o) => ({ ...o, correct: q.correct.includes(o.id) })),
          explanation: q.explanation ?? "",
          tags: q.tags,
          difficulty: q.difficulty,
          points: q.points,
          status: q.status,
          source: q.source,
        }))}
      />
      {rows.length === 0 && (
        <EmptyState title="No questions match" body="Add the first one with “New question”." />
      )}
    </Page>
  );
}
