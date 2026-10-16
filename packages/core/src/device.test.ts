import { describe, expect, it } from "vitest";
import { isMobileClient } from "./device";

describe("isMobileClient", () => {
  it("trusts the Sec-CH-UA-Mobile client hint", () => {
    expect(isMobileClient({ secChUaMobile: "?1" })).toBe(true);
    expect(isMobileClient({ secChUaMobile: "?0", userAgent: "Mozilla/5.0 (iPhone)" })).toBe(false);
  });

  it.each([
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148",
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/130.0 Mobile Safari/537.36",
  ])("detects phones by user agent: %s", (ua) => {
    expect(isMobileClient({ userAgent: ua })).toBe(true);
  });

  it.each([
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) Safari/605.1.15",
  ])("treats desktops as desktop: %s", (ua) => {
    expect(isMobileClient({ userAgent: ua })).toBe(false);
  });

  it("treats a missing user agent as desktop, leaving the viewport check as the backstop", () => {
    expect(isMobileClient({})).toBe(false);
  });
});
