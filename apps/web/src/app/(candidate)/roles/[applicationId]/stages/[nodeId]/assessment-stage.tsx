"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Clock, Maximize } from "lucide-react";
import { Alert, Button } from "@/components/ui";
import {
  getQuestionsAction,
  integrityAction,
  saveAnswerAction,
  startAssessmentAction,
  submitAssessmentAction,
} from "@/app/(candidate)/stage-actions";

type Question = {
  id: string;
  type: "mcq" | "multi" | "short" | "long";
  body: string;
  options: { id: string; text: string }[];
};
type Answer = string | string[];
type IntegrityEvent = { type: string; at: string; durationMs?: number };

const fmt = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function AssessmentStage({
  applicationId,
  nodeId,
  durationMin,
  questionCount,
  started,
}: {
  applicationId: string;
  nodeId: string;
  durationMin: number;
  questionCount: number;
  started: boolean;
  canSubmit: boolean;
  closesAt: string | null;
}) {
  const t = useTranslations("stage.assessment");
  const router = useRouter();
  const ids = { applicationId, nodeId };
  const [phase, setPhase] = useState<"intro" | "loading" | "running" | "done">(
    started ? "loading" : "intro",
  );
  const [error, setError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [index, setIndex] = useState(0);
  const [endsAt, setEndsAt] = useState(0);
  const [offset, setOffset] = useState(0);
  const [remaining, setRemaining] = useState(durationMin * 60_000);
  const [confirming, setConfirming] = useState(false);
  const [outOfFullscreen, setOutOfFullscreen] = useState(false);
  const [pasteNotice, setPasteNotice] = useState(false);
  const events = useRef<IntegrityEvent[]>([]);
  const awaySince = useRef<{ type: string; at: number } | null>(null);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const submitting = useRef(false);

  const load = useCallback(async () => {
    const view = await getQuestionsAction(ids);
    if (!view) return setError("Couldn't load the test. Refresh the page.");
    if (view.submitted) return setPhase("done");
    setQuestions(view.questions as Question[]);
    setAnswers(view.answers as Record<string, Answer>);
    setOffset(Date.parse(view.now) - Date.now());
    setEndsAt(Date.parse(view.endsAt));
    setPhase("running");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId, nodeId]);

  useEffect(() => {
    if (started) void load();
  }, [started, load]);

  const flush = useCallback(async () => {
    if (events.current.length === 0) return;
    const batch = events.current.splice(0);
    await integrityAction({ ...ids, events: batch });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId, nodeId]);

  const finish = useCallback(async () => {
    if (submitting.current) return;
    submitting.current = true;
    await Promise.all(Object.values(saveTimers.current).map((tm) => clearTimeout(tm)));
    await flush();
    await submitAssessmentAction(ids);
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    setPhase("done");
    router.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flush, router, applicationId, nodeId]);

  // Timer from the server's end time; submits at zero (the server sweep is the backstop).
  useEffect(() => {
    if (phase !== "running") return;
    const tick = () => {
      const left = endsAt - (Date.now() + offset);
      setRemaining(left);
      if (left <= 0) void finish();
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [phase, endsAt, offset, finish]);

  // Integrity signals: recorded for reviewers, never auto-penalised.
  useEffect(() => {
    if (phase !== "running") return;
    const now = () => new Date().toISOString();
    const leave = (type: string) => {
      if (!awaySince.current) awaySince.current = { type, at: Date.now() };
    };
    const back = () => {
      if (awaySince.current) {
        events.current.push({
          type: awaySince.current.type,
          at: new Date(awaySince.current.at).toISOString(),
          durationMs: Date.now() - awaySince.current.at,
        });
        awaySince.current = null;
      }
    };
    const onVisibility = () => (document.hidden ? leave("visibility_hidden") : back());
    // Browsers without the Fullscreen API can't comply, so don't block them; still log it.
    const fullscreenPossible = document.fullscreenEnabled === true;
    const onFullscreen = () => {
      if (!document.fullscreenElement) {
        if (!fullscreenPossible) return;
        setOutOfFullscreen(true);
        leave("fullscreen_exit");
      } else {
        setOutOfFullscreen(false);
        back();
      }
    };
    const onBlur = () => events.current.push({ type: "blur", at: now() });
    const onCopy = () => events.current.push({ type: "copy_attempt", at: now() });
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("fullscreenchange", onFullscreen);
    window.addEventListener("blur", onBlur);
    document.addEventListener("copy", onCopy);
    if (fullscreenPossible && !document.fullscreenElement) setOutOfFullscreen(true);
    const flusher = setInterval(() => void flush(), 10_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("fullscreenchange", onFullscreen);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("copy", onCopy);
      clearInterval(flusher);
    };
  }, [phase, flush]);

  async function begin() {
    setError(null);
    // Don't wait on full-screen: some embedded browsers never settle the request.
    void document.documentElement.requestFullscreen?.().catch(() => {});
    setPhase("loading");
    const res = await startAssessmentAction(ids);
    if (!res.ok) {
      setPhase("intro");
      return setError(res.error);
    }
    await load();
  }

  function answer(q: Question, value: Answer) {
    setAnswers((a) => ({ ...a, [q.id]: value }));
    clearTimeout(saveTimers.current[q.id]);
    saveTimers.current[q.id] = setTimeout(
      () => void saveAnswerAction({ ...ids, questionId: q.id, value }),
      q.type === "long" || q.type === "short" ? 600 : 50,
    );
  }

  const blockPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    events.current.push({ type: "paste_attempt", at: new Date().toISOString() });
    setPasteNotice(true);
    setTimeout(() => setPasteNotice(false), 2500);
  };

  if (phase === "done") return <Alert tone="success">{t("done")}</Alert>;

  if (phase === "intro") {
    return (
      <section className="rounded-card border border-border bg-surface p-8 shadow-card">
        <p className="font-display text-xl font-semibold">
          {t("intro", { count: questionCount, minutes: durationMin })}
        </p>
        <ul className="mt-4 list-disc space-y-2 pl-5">
          {(t.raw("rules") as string[]).map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        {error && (
          <div className="mt-4">
            <Alert support>{error}</Alert>
          </div>
        )}
        <Button className="mt-6 !w-auto px-8" onClick={begin}>
          <Maximize size={18} aria-hidden className="mr-2" /> {t("start")}
        </Button>
      </section>
    );
  }

  if (phase === "loading" || questions.length === 0) {
    return error ? <Alert support>{error}</Alert> : <p className="text-muted">…</p>;
  }

  const q = questions[index]!;
  const value = answers[q.id];
  const answered = questions.filter((x) => {
    const v = answers[x.id];
    return Array.isArray(v) ? v.length > 0 : !!v?.toString().trim();
  }).length;
  const low = remaining < 60_000;

  return (
    <section
      className="relative rounded-card border border-border bg-surface shadow-card"
      onPaste={blockPaste}
    >
      <div className="sticky top-0 z-10 flex items-center justify-between gap-4 rounded-t-card border-b border-border bg-surface px-6 py-3">
        <span className="font-semibold">
          {t("question", { n: index + 1, total: questions.length })}
        </span>
        <span
          className={`flex items-center gap-2 rounded-full px-3 py-1 font-mono text-lg font-bold ${low ? "bg-danger-bg text-danger-fg" : "bg-neutral-bg"}`}
          role="timer"
          aria-label={t("timeLeft")}
        >
          <Clock size={18} aria-hidden /> {fmt(remaining)}
        </span>
      </div>
      <div className="p-8">
        <p className="whitespace-pre-line text-lg font-medium">{q.body}</p>
        <div className="mt-6 space-y-2">
          {q.type === "mcq" &&
            q.options.map((o) => (
              <label
                key={o.id}
                className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 ${value === o.id ? "border-brand-500 bg-brand-soft" : "border-border"}`}
              >
                <input
                  type="radio"
                  name={q.id}
                  checked={value === o.id}
                  onChange={() => answer(q, o.id)}
                />
                {o.text}
              </label>
            ))}
          {q.type === "multi" &&
            q.options.map((o) => {
              const list = Array.isArray(value) ? value : [];
              return (
                <label
                  key={o.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 ${list.includes(o.id) ? "border-brand-500 bg-brand-soft" : "border-border"}`}
                >
                  <input
                    type="checkbox"
                    checked={list.includes(o.id)}
                    onChange={(e) =>
                      answer(q, e.target.checked ? [...list, o.id] : list.filter((x) => x !== o.id))
                    }
                  />
                  {o.text}
                </label>
              );
            })}
          {(q.type === "short" || q.type === "long") && (
            <textarea
              aria-label={t("writeAnswer")}
              className={`w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 ${q.type === "long" ? "min-h-56" : "min-h-20"}`}
              value={(value as string) ?? ""}
              onChange={(e) => answer(q, e.target.value)}
              onPaste={blockPaste}
              onDrop={(e) => e.preventDefault()}
            />
          )}
        </div>
        {pasteNotice && <p className="mt-2 text-sm text-warning-fg">{t("pasteBlocked")}</p>}
        <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2">
            <button
              className="rounded-xl border border-border px-4 py-2 font-semibold disabled:opacity-40"
              disabled={index === 0}
              onClick={() => setIndex((i) => i - 1)}
            >
              {t("prev")}
            </button>
            <button
              className="rounded-xl border border-border px-4 py-2 font-semibold disabled:opacity-40"
              disabled={index === questions.length - 1}
              onClick={() => setIndex((i) => i + 1)}
            >
              {t("next")}
            </button>
          </div>
          <Button className="!w-auto px-6" onClick={() => setConfirming(true)}>
            {t("finish")}
          </Button>
        </div>
        <nav aria-label="Questions" className="mt-6 flex flex-wrap gap-1.5">
          {questions.map((x, i) => {
            const v = answers[x.id];
            const done = Array.isArray(v) ? v.length > 0 : !!v?.toString().trim();
            return (
              <button
                key={x.id}
                onClick={() => setIndex(i)}
                aria-current={i === index}
                aria-label={`Question ${i + 1}${done ? ", answered" : ""}`}
                className={`h-9 w-9 rounded-lg text-sm font-semibold ${i === index ? "ring-2 ring-brand-500" : ""} ${done ? "bg-brand-500 text-white" : "bg-neutral-bg"}`}
              >
                {i + 1}
              </button>
            );
          })}
        </nav>
      </div>

      {confirming && (
        <div className="absolute inset-0 z-20 grid place-items-center rounded-card bg-black/50 p-6">
          <div className="max-w-md rounded-card bg-surface p-6 shadow-card">
            <h2 className="font-display text-xl font-bold">{t("confirmTitle")}</h2>
            <p className="mt-2 text-muted">
              {t("confirmBody", { answered, total: questions.length })}
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                className="rounded-xl border border-border px-4 py-2 font-semibold"
                onClick={() => setConfirming(false)}
              >
                {t("prev")}
              </button>
              <Button className="!w-auto px-6" onClick={() => void finish()}>
                {t("finish")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {outOfFullscreen && !confirming && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-6"
          role="alertdialog"
          aria-modal="true"
        >
          <div className="max-w-md rounded-card bg-surface p-8 text-center shadow-card">
            <h2 className="font-display text-xl font-bold">{t("fullscreenTitle")}</h2>
            <p className="mt-2 text-muted">{t("fullscreenBody")}</p>
            <p className="mt-3 font-mono text-lg font-bold">{fmt(remaining)}</p>
            <Button
              className="mt-5"
              onClick={() => void document.documentElement.requestFullscreen().catch(() => {})}
            >
              {t("fullscreenButton")}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
