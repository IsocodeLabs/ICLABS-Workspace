"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { PROBLEM_ID_KEY } from "@iclabs/core/workflow";
import { Markdown } from "@/components/markdown";
import { Alert, Button } from "@/components/ui";
import { submitTaskAction } from "@/app/(candidate)/stage-actions";
import { FileUpload } from "./file-upload";
import { SubmittedNotice, type NextStep } from "./submitted-notice";
import { reportError } from "@/lib/client-errors";

type Deliverable = {
  id: string;
  kind: "file" | "link" | "text";
  label: string;
  required: boolean;
  allowedDomains?: string[];
};

const ist = (d: string | Date) =>
  `${new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })} IST`;

const input =
  "w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-base outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-soft";

type Section = { label: string | null; lines: string[] };

/** Splits a problem statement at its "LABEL:" lines so each part can be laid out on its own. */
function parseStatement(body: string): Section[] {
  const out: Section[] = [];
  for (const line of body.split("\n")) {
    const m = /^([A-Z][A-Z ]{2,}):\s?(.*)$/.exec(line);
    if (m) out.push({ label: m[1]!, lines: m[2] ? [m[2]] : [] });
    else if (out.length === 0) out.push({ label: null, lines: [line] });
    else out[out.length - 1]!.lines.push(line);
  }
  return out.map((s) => ({ ...s, lines: s.lines.filter((l) => l.trim()) }));
}

const titleCase = (label: string) => label.charAt(0) + label.slice(1).toLowerCase();

function StatementBody({ body }: { body: string }) {
  return (
    <div className="space-y-5">
      {parseStatement(body).map((sec, i) => {
        const rows = sec.lines.filter((l) => l.includes(" | "));
        const isTable = rows.length >= 2 && rows.length === sec.lines.length;
        const bullets = sec.lines.filter((l) => l.startsWith("- "));
        const isList = !isTable && bullets.length > 0 && bullets.length === sec.lines.length;
        const core = sec.label === "CORE BUILD";
        return (
          <div
            key={i}
            className={core ? "rounded-xl border border-border bg-neutral-bg p-4" : undefined}
          >
            {sec.label && (
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
                {titleCase(sec.label)}
              </p>
            )}
            {isTable ? (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-neutral-bg text-left">
                      {rows[0]!.split(" | ").map((c, j) => (
                        <th key={j} className="whitespace-nowrap px-3 py-2 font-semibold">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(1).map((r, j) => (
                      <tr key={j} className="border-t border-border">
                        {r.split(" | ").map((c, k) => (
                          <td key={k} className="px-3 py-2 align-top">
                            {c}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : isList ? (
              <ul className="list-disc space-y-1 pl-5 text-[15px] leading-relaxed">
                {bullets.map((b, j) => (
                  <li key={j}>{b.slice(2)}</li>
                ))}
              </ul>
            ) : (
              <p className="whitespace-pre-line text-[15px] leading-relaxed">
                {sec.lines.join("\n")}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function StepPills({ active, labels }: { active: 1 | 2 | 3; labels: [string, string, string] }) {
  return (
    <ol className="flex flex-wrap gap-2 text-sm">
      {labels.map((label, i) => {
        const n = i + 1;
        const done = n < active;
        const now = n === active;
        return (
          <li
            key={label}
            className={`flex items-center gap-2 rounded-full border px-3 py-1.5 transition ${now ? "border-brand-500 bg-surface font-semibold shadow-card" : "border-border text-muted"}`}
          >
            <span
              className={`flex size-5 items-center justify-center rounded-full text-xs ${done || now ? "bg-brand-500 text-white" : "bg-neutral-bg"}`}
            >
              {done ? <Check className="size-3" aria-hidden /> : n}
            </span>
            {label}
          </li>
        );
      })}
    </ol>
  );
}

export function TaskStage({
  applicationId,
  nodeId,
  brief,
  deliverables,
  problemStatements,
  allowResubmit,
  last,
  closed,
  canSubmit,
  canEdit,
  nextStep,
}: {
  applicationId: string;
  nodeId: string;
  brief: string;
  deliverables: Deliverable[];
  problemStatements: { id: string; title: string; body: string }[];
  allowResubmit: boolean;
  draft: Record<string, string>;
  last: {
    version: number;
    data: Record<string, string>;
    submittedAt: string;
    isLate: boolean;
    files: Record<string, string>;
  } | null;
  closed: boolean;
  canSubmit: boolean;
  /** Handed in, and can still be changed until the step closes. */
  canEdit: boolean;
  closesAt: string | null;
  nextStep: NextStep;
}) {
  const t = useTranslations("stage");
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(last?.data ?? {});
  // Files already handed in show by name, so they can be kept or replaced.
  const [files, setFiles] = useState<Record<string, { id: string; name: string } | null>>(() =>
    Object.fromEntries(
      deliverables
        .filter((d) => d.kind === "file" && last?.data[d.id] && last.files[last.data[d.id]!])
        .map((d) => [d.id, { id: last!.data[d.id]!, name: last!.files[last!.data[d.id]!]! }]),
    ),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  // Set the moment a submission lands, before the refresh brings back `last`.
  const [justSubmitted, setJustSubmitted] = useState<{ at: string; late: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const noticeRef = useRef<HTMLDivElement>(null);
  const submitRef = useRef<HTMLElement>(null);
  // Which problem statement is open for reading. They all start closed.
  const [openId, setOpenId] = useState<string | null>(null);
  const editable = !closed && (canSubmit || (!!last && (allowResubmit || canEdit)));

  async function submit() {
    setBusy(true);
    const payload = { ...values };
    for (const [k, f] of Object.entries(files)) if (f) payload[k] = f.id;
    let res: Awaited<ReturnType<typeof submitTaskAction>>;
    try {
      res = await submitTaskAction({ applicationId, nodeId, deliverables: payload });
    } catch (e) {
      // Usually the workspace was updated while this page was open.
      setBusy(false);
      setError(t("staleSubmitTask"));
      reportError(e, "task-submit", t("staleSubmitTask"));
      return;
    }
    setBusy(false);
    if (res.ok) {
      setErrors({});
      setError(null);
      setJustSubmitted({ at: new Date().toISOString(), late: !!res.late });
      router.refresh();
      requestAnimationFrame(() =>
        noticeRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }),
      );
    } else {
      setErrors(res.fieldErrors ?? {});
      setError(res.error);
    }
  }

  const submittedAt = justSubmitted?.at ?? last?.submittedAt;
  const hasPick = problemStatements.length > 0;
  const chosenId = values[PROBLEM_ID_KEY];
  const chosen = problemStatements.find((p) => p.id === chosenId) ?? null;
  const showSubmit = !hasPick || !!chosen;

  function choose(id: string) {
    setValues((v) => ({ ...v, [PROBLEM_ID_KEY]: id }));
    setErrors((e) => ({ ...e, [PROBLEM_ID_KEY]: "" }));
    setOpenId(null);
    requestAnimationFrame(() =>
      submitRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }

  return (
    <div className="space-y-6">
      {submittedAt && (
        <div ref={noticeRef}>
          <SubmittedNotice
            date={ist(submittedAt)}
            late={justSubmitted?.late ?? last?.isLate ?? false}
            next={nextStep}
          />
        </div>
      )}
      {hasPick && (
        <StepPills
          active={chosen ? 3 : 2}
          labels={[t("stepBrief"), t("stepChoose"), t("stepSubmit")]}
        />
      )}
      {brief && (
        <section className="rounded-card border border-border bg-surface p-6 shadow-card sm:p-8">
          <h2 className="mb-3 font-display text-xl font-semibold">{t("brief")}</h2>
          <Markdown>{brief}</Markdown>
        </section>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="space-y-6"
        noValidate
      >
        {error && <Alert support>{error}</Alert>}
        <fieldset disabled={!editable || busy} className="space-y-6">
          {hasPick && (
            <section className="rounded-card border border-border bg-surface p-6 shadow-card sm:p-8">
              <div role="group" aria-labelledby="ps-label">
                <h2 id="ps-label" className="font-display text-xl font-semibold">
                  {t("problemPick")}
                  <span className="ml-2 text-sm font-normal text-muted">({t("required")})</span>
                </h2>
                <p className="mb-1 mt-1.5 text-sm text-muted">{t("problemHint")}</p>
                <p className="mb-4 text-sm font-medium">
                  {t("problemCount", { count: problemStatements.length })}
                </p>
                <div className="space-y-3">
                  {problemStatements.map((p, i) => {
                    const isChosen = chosenId === p.id;
                    const isOpen = openId === p.id;
                    return (
                      <div
                        key={p.id}
                        className={`overflow-hidden rounded-xl border transition ${isChosen ? "border-brand-500 ring-2 ring-brand-soft" : "border-border"}`}
                      >
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          aria-controls={`ps-${p.id}`}
                          onClick={() => setOpenId(isOpen ? null : p.id)}
                          className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-neutral-bg"
                        >
                          <span
                            className={`flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${isChosen ? "bg-brand-500 text-white" : "bg-neutral-bg"}`}
                          >
                            {isChosen ? <Check className="size-4" aria-hidden /> : i + 1}
                          </span>
                          <span className="min-w-0 flex-1 font-semibold">{p.title}</span>
                          {isChosen && (
                            <span className="hidden rounded-full bg-neutral-bg px-2.5 py-0.5 text-xs font-semibold sm:inline">
                              {t("chosen")}
                            </span>
                          )}
                          <ChevronDown
                            className={`size-5 shrink-0 text-muted transition-transform ${isOpen ? "rotate-180" : ""}`}
                            aria-hidden
                          />
                        </button>
                        {isOpen && (
                          <div id={`ps-${p.id}`} className="border-t border-border px-4 pb-5 pt-4">
                            <StatementBody body={p.body} />
                            <div className="mt-5 flex justify-end border-t border-border pt-4">
                              <Button
                                type="button"
                                className="!w-auto px-6"
                                onClick={() => choose(p.id)}
                              >
                                {isChosen ? t("chosenOpen") : t("chooseThis")}
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {errors[PROBLEM_ID_KEY] && (
                  <p className="mt-2 text-sm text-danger-fg">{t("errors.problem")}</p>
                )}
              </div>
            </section>
          )}

          {showSubmit && (
            <section
              ref={submitRef}
              className="scroll-mt-6 rounded-card border border-border bg-surface p-6 shadow-card sm:p-8"
            >
              <h2 className="font-display text-xl font-semibold">{t("yourSubmission")}</h2>
              {chosen && (
                <p className="mb-5 mt-2 rounded-xl bg-neutral-bg px-4 py-3 text-sm">
                  <span className="text-muted">{t("yourProblem")}: </span>
                  <span className="font-semibold">{chosen.title}</span>
                </p>
              )}
              {deliverables.map((d) => {
                const id = `d-${d.id}`;
                return (
                  <div key={d.id} className="mb-5">
                    <label htmlFor={id} className="mb-1.5 block font-semibold">
                      {d.label}
                      {d.required && (
                        <span className="ml-1 text-sm font-normal text-muted">
                          ({t("required")})
                        </span>
                      )}
                    </label>
                    {d.kind === "file" ? (
                      <FileUpload
                        id={id}
                        value={files[d.id] ?? null}
                        onChange={(f) => setFiles((x) => ({ ...x, [d.id]: f }))}
                      />
                    ) : d.kind === "text" ? (
                      <textarea
                        id={id}
                        className={`${input} min-h-32`}
                        value={values[d.id] ?? ""}
                        onChange={(e) => setValues((v) => ({ ...v, [d.id]: e.target.value }))}
                      />
                    ) : (
                      <input
                        id={id}
                        type="url"
                        placeholder={
                          d.allowedDomains?.length ? `https://${d.allowedDomains[0]}/…` : "https://"
                        }
                        className={input}
                        value={values[d.id] ?? ""}
                        onChange={(e) => setValues((v) => ({ ...v, [d.id]: e.target.value }))}
                      />
                    )}
                    {errors[d.id] && (
                      <p className="mt-1 text-sm text-danger-fg">
                        {t(`errors.${errors[d.id]}` as "errors.required")}
                      </p>
                    )}
                  </div>
                );
              })}
              {(allowResubmit || canEdit) && last && (
                <p className="mb-4 text-sm text-muted">{t("versions")}</p>
              )}
              {editable && (
                <Button type="submit" disabled={busy} className="!w-auto px-8">
                  {last ? t("resubmit") : t("submit")}
                </Button>
              )}
            </section>
          )}
        </fieldset>
      </form>
    </div>
  );
}
