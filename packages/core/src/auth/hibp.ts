import { createHash } from "node:crypto";

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export type PwnedResult = { checked: boolean; pwned: boolean };

/**
 * Have I Been Pwned k-anonymity lookup: only the first 5 characters of the SHA-1 hash leave
 * the server. Fails open (`checked: false`) so an outage never blocks a password change.
 */
export async function checkPwnedPassword(
  password: string,
  fetchFn: FetchFn = fetch,
): Promise<PwnedResult> {
  const hash = createHash("sha1").update(password).digest("hex").toUpperCase();
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  try {
    const res = await fetchFn(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true" },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return { checked: false, pwned: false };
    const body = await res.text();
    const pwned = body.split(/\r?\n/).some((line) => {
      const [lineSuffix, count] = line.split(":");
      return lineSuffix === suffix && Number(count) > 0;
    });
    return { checked: true, pwned };
  } catch {
    return { checked: false, pwned: false };
  }
}
