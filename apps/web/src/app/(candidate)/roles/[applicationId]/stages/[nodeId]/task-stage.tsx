"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
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
      {brief && (
        <section className="rounded-card border border-border bg-surface p-8 shadow-card">
          <h2 className="mb-3 font-display text-xl font-semibold">{t("brief")}</h2>
          <Markdown>{brief}</Markdown>
        </section>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="rounded-card border border-border bg-surface p-8 shadow-card"
        noValidate
      >
        <h2 className="mb-4 font-display text-xl font-semibold">{t("deliverables")}</h2>
        {error && <Alert support>{error}</Alert>}
        <fieldset disabled={!editable || busy}>
          {problemStatements.length > 0 && (
            <div role="radiogroup" aria-labelledby="ps-label" className="mb-6">
              <p id="ps-label" className="mb-1.5 font-semibold">
                {t("problemPick")}
                <span className="ml-1 text-sm font-normal text-muted">({t("required")})</span>
              </p>
              <p className="mb-3 text-sm text-muted">{t("problemHint")}</p>
              <div className="space-y-3">
                {problemStatements.map((p, i) => {
                  const chosen = values[PROBLEM_ID_KEY] === p.id;
                  return (
                    <label
                      key={p.id}
                      className={`block cursor-pointer rounded-xl border p-4 transition ${chosen ? "border-brand-500 ring-2 ring-brand-soft" : "border-border hover:border-brand-500"}`}
                    >
                      <span className="flex items-start gap-3">
                        <input
                          type="radio"
                          name="problem-statement"
                          className="mt-1.5"
                          checked={chosen}
                          onChange={() => setValues((v) => ({ ...v, [PROBLEM_ID_KEY]: p.id }))}
                        />
                        <span>
                          <span className="block font-semibold">
                            {i + 1}. {p.title}
                          </span>
                          {p.body && (
                            <span className="mt-1 block whitespace-pre-line text-sm leading-relaxed">
                              {p.body}
                            </span>
                          )}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
              {errors[PROBLEM_ID_KEY] && (
                <p className="mt-1 text-sm text-danger-fg">{t("errors.problem")}</p>
              )}
            </div>
          )}
          {deliverables.map((d) => {
            const id = `d-${d.id}`;
            return (
              <div key={d.id} className="mb-5">
                <label htmlFor={id} className="mb-1.5 block font-semibold">
                  {d.label}
                  {d.required && (
                    <span className="ml-1 text-sm font-normal text-muted">({t("required")})</span>
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
                    className={`${input} min-h-40`}
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
        </fieldset>
        {(allowResubmit || canEdit) && last && (
          <p className="mb-4 text-sm text-muted">{t("versions")}</p>
        )}
        {editable && (
          <Button type="submit" disabled={busy} className="!w-auto px-8">
            {last ? t("resubmit") : t("submit")}
          </Button>
        )}
      </form>
    </div>
  );
}
