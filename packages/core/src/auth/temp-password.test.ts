import { describe, expect, it } from "vitest";
import {
  TEMP_PASSWORD_ALPHABET,
  TEMP_PASSWORD_TTL_MS,
  generateTempPassword,
  isTempPasswordExpired,
  tempPasswordExpiry,
} from "./temp-password";

describe("generateTempPassword", () => {
  it("produces three dash-separated groups of four characters", () => {
    expect(generateTempPassword()).toMatch(/^[^-]{4}-[^-]{4}-[^-]{4}$/);
  });

  it("only uses the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) {
      for (const ch of generateTempPassword().replaceAll("-", "")) {
        expect(TEMP_PASSWORD_ALPHABET).toContain(ch);
      }
    }
  });

  it("alphabet excludes look-alike characters", () => {
    for (const ch of ["0", "O", "o", "1", "l", "I"]) {
      expect(TEMP_PASSWORD_ALPHABET).not.toContain(ch);
    }
  });

  it("does not repeat across many generations", () => {
    const seen = new Set(Array.from({ length: 1000 }, () => generateTempPassword()));
    expect(seen.size).toBe(1000);
  });
});

describe("temp password expiry", () => {
  const now = new Date("2026-10-16T10:00:00Z");

  it("is valid for 72 hours", () => {
    expect(TEMP_PASSWORD_TTL_MS).toBe(72 * 60 * 60 * 1000);
    expect(tempPasswordExpiry(now).toISOString()).toBe("2026-10-19T10:00:00.000Z");
  });

  it("is not expired before the deadline and expired at it", () => {
    const expiresAt = tempPasswordExpiry(now);
    expect(isTempPasswordExpired(expiresAt, new Date(expiresAt.getTime() - 1))).toBe(false);
    expect(isTempPasswordExpired(expiresAt, expiresAt)).toBe(true);
  });

  it("treats a missing expiry as not expired (no temp password pending)", () => {
    expect(isTempPasswordExpired(null, now)).toBe(false);
  });
});
