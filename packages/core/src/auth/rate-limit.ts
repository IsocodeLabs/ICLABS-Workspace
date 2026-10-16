export type RateLimitRule = { limit: number; windowMs: number };
export type RateLimitBucket = { count: number; windowStart: Date };

/** Fixed-window counter. The caller persists `bucket` (see the `rate_limits` table). */
export function consumeRateLimit(
  bucket: RateLimitBucket | null,
  now: Date,
  rule: RateLimitRule,
): { allowed: boolean; bucket: RateLimitBucket; retryAfterMs: number } {
  const windowOpen =
    bucket !== null && now.getTime() - bucket.windowStart.getTime() < rule.windowMs;
  const current = windowOpen ? bucket : { count: 0, windowStart: now };
  const next = { count: current.count + 1, windowStart: current.windowStart };
  const allowed = next.count <= rule.limit;
  const retryAfterMs = allowed ? 0 : current.windowStart.getTime() + rule.windowMs - now.getTime();
  return { allowed, bucket: next, retryAfterMs };
}
