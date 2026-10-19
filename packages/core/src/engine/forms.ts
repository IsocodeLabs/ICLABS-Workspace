import type { FormField } from "../workflow/schema";

export type FieldError =
  "required" | "url" | "domain" | "option" | "email" | "number" | "too_long" | "too_many_words";

/** Words as a person would count them: runs of non-space characters. */
export const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/** Server-side check of a form/custom-step submission. Returns field id → problem. */
export function validateFormAnswers(
  fields: FormField[],
  answers: Record<string, unknown>,
): Record<string, FieldError> {
  const errors: Record<string, FieldError> = {};
  for (const f of fields) {
    if (f.kind === "section") continue;
    const raw = answers[f.id];
    const values = (Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw])
      .map((v) => String(v).trim())
      .filter(Boolean);
    if (values.length === 0) {
      if (f.required && f.kind !== "file") errors[f.id] = "required";
      continue;
    }
    const v = values[0]!;
    if (values.some((x) => x.length > 10_000)) errors[f.id] = "too_long";
    else if (f.maxWords && wordCount(v) > f.maxWords) errors[f.id] = "too_many_words";
    else if (f.kind === "url") {
      let url: URL | null = null;
      try {
        url = new URL(v);
      } catch {
        url = null;
      }
      if (!url || !/^https?:$/.test(url.protocol)) errors[f.id] = "url";
      else if (
        f.allowedDomains?.length &&
        !f.allowedDomains.some((d) => url.hostname === d || url.hostname.endsWith(`.${d}`))
      ) {
        errors[f.id] = "domain";
      }
    } else if (f.kind === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) errors[f.id] = "email";
    else if ((f.kind === "number" || f.kind === "rating") && !Number.isFinite(Number(v)))
      errors[f.id] = "number";
    else if ((f.kind === "single_choice" || f.kind === "multi_choice") && f.options?.length) {
      if (values.some((x) => !f.options!.includes(x))) errors[f.id] = "option";
    }
  }
  return errors;
}
