export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 128;

export type PasswordIssue = "too_short" | "too_long" | "same_as_previous";

/** Rules for a password a candidate chooses. The breached-password check runs separately. */
export function validateNewPassword(
  password: string,
  opts: { previous?: string } = {},
): PasswordIssue[] {
  const issues: PasswordIssue[] = [];
  const length = password.trim().length;
  if (length < MIN_PASSWORD_LENGTH) issues.push("too_short");
  if (password.length > MAX_PASSWORD_LENGTH) issues.push("too_long");
  if (opts.previous !== undefined && password === opts.previous) issues.push("same_as_previous");
  return issues;
}
