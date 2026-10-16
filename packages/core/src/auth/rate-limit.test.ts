import { describe, expect, it } from "vitest";
import { consumeRateLimit, type RateLimitBucket } from "./rate-limit";

const rule = { limit: 5, windowMs: 60_000 };
const t0 = new Date("2026-10-16T10:00:00Z");
const at = (ms: number) => new Date(t0.getTime() + ms);

describe("consumeRateLimit", () => {
  it("allows up to the limit within a window, then blocks", () => {
    let bucket: RateLimitBucket | null = null;
    for (let i = 0; i < 5; i++) {
      const r = consumeRateLimit(bucket, at(i * 1000), rule);
      expect(r.allowed).toBe(true);
      bucket = r.bucket;
    }
    const blocked = consumeRateLimit(bucket, at(10_000), rule);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(50_000);
  });

  it("starts a new window once the old one has elapsed", () => {
    let bucket: RateLimitBucket | null = null;
    for (let i = 0; i < 6; i++) bucket = consumeRateLimit(bucket, t0, rule).bucket;
    const r = consumeRateLimit(bucket, at(60_000), rule);
    expect(r.allowed).toBe(true);
    expect(r.bucket.count).toBe(1);
  });
});
