"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import type { FormField } from "@iclabs/core/workflow";
import { FormStage } from "./form-stage";

/**
 * Under a handed-in form while the step is still open: change answers or replace a file. The
 * form opens with what they handed in (files by name); saving makes a new version.
 */
export function EditAnswers({
  applicationId,
  nodeId,
  fields,
  closesAt,
  answers,
  files,
}: {
  applicationId: string;
  nodeId: string;
  fields: FormField[];
  closesAt: string;
  answers: Record<string, unknown>;
  /** File id → name, for the files in this version. */
  files: Record<string, string>;
}) {
  const t = useTranslations("stage");
  const [open, setOpen] = useState(false);
  const initial = Object.fromEntries(
    fields.map((f) => {
      const v = answers[f.id];
      if (f.kind === "file")
        return [f.id, typeof v === "string" && files[v] ? { id: v, name: files[v] } : null];
      return [f.id, v ?? null];
    }),
  );

  if (open)
    return (
      <div className="mt-6">
        <FormStage
          applicationId={applicationId}
          nodeId={nodeId}
          fields={fields}
          draft={initial}
          canSubmit
          closesAt={null}
          editing
          onDone={() => setOpen(false)}
        />
      </div>
    );
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface p-5">
      <p className="text-sm">{t("editOpen", { date: closesAt })}</p>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-xl border border-border px-4 py-2 text-sm font-semibold hover:border-brand-500"
      >
        {t("editAnswers")}
      </button>
    </div>
  );
}
