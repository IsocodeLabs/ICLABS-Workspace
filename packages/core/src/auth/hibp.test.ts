import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { checkPwnedPassword } from "./hibp";

function sha1(s: string) {
  return createHash("sha1").update(s).digest("hex").toUpperCase();
}

function fakeFetch(body: string, ok = true) {
  return vi.fn(
    async (_url: string, _init?: RequestInit) => new Response(body, { status: ok ? 200 : 503 }),
  );
}

describe("checkPwnedPassword", () => {
  const pw = "password123456";
  const hash = sha1(pw);

  it("only sends the first 5 hash characters, with padding requested", async () => {
    const fetchFn = fakeFetch("");
    await checkPwnedPassword(pw, fetchFn);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`);
    expect(url).not.toContain(hash.slice(5));
    expect(new Headers(init?.headers).get("Add-Padding")).toBe("true");
  });

  it("reports a breached password", async () => {
    const res = await checkPwnedPassword(pw, fakeFetch(`AAAA:1\r\n${hash.slice(5)}:42\r\n`));
    expect(res).toEqual({ checked: true, pwned: true });
  });

  it("ignores padding entries with a zero count", async () => {
    const res = await checkPwnedPassword(pw, fakeFetch(`${hash.slice(5)}:0`));
    expect(res).toEqual({ checked: true, pwned: false });
  });

  it("fails open when the API is unavailable", async () => {
    expect(await checkPwnedPassword(pw, fakeFetch("", false))).toEqual({
      checked: false,
      pwned: false,
    });
    const throwing = vi.fn(async () => {
      throw new Error("network");
    });
    expect(await checkPwnedPassword(pw, throwing)).toEqual({ checked: false, pwned: false });
  });
});
