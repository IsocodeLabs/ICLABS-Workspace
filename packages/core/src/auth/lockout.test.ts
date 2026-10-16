import { describe, expect, it } from "vitest";
import {
  CAPTCHA_AFTER_FAILURES,
  LOCK_DURATION_MS,
  MAX_FAILED_ATTEMPTS,
  captchaRequired,
  isLocked,
  registerFailure,
  registerSuccess,
  type LoginState,
} from "./lockout";

const now = new Date("2026-10-16T10:00:00Z");
const fresh: LoginState = { failedCount: 0, lockedUntil: null };

function failTimes(n: number, start: LoginState = fresh, at = now) {
  let state = start;
  let justLocked = false;
  for (let i = 0; i < n; i++) ({ state, justLocked } = registerFailure(state, at));
  return { state, justLocked };
}

describe("lockout", () => {
  it("locks for 15 minutes on the 10th consecutive failure", () => {
    expect(MAX_FAILED_ATTEMPTS).toBe(10);
    const nine = failTimes(9);
    expect(nine.justLocked).toBe(false);
    expect(isLocked(nine.state, now)).toBe(false);

    const ten = failTimes(1, nine.state);
    expect(ten.justLocked).toBe(true);
    expect(ten.state.lockedUntil?.getTime()).toBe(now.getTime() + LOCK_DURATION_MS);
    expect(isLocked(ten.state, now)).toBe(true);
  });

  it("unlocks once the lock period has passed", () => {
    const { state } = failTimes(10);
    expect(isLocked(state, new Date(now.getTime() + LOCK_DURATION_MS))).toBe(false);
  });

  it("restarts the failure count after a lock expires", () => {
    const { state } = failTimes(10);
    const later = new Date(now.getTime() + LOCK_DURATION_MS + 1);
    const next = registerFailure(state, later);
    expect(next.state.failedCount).toBe(1);
    expect(next.state.lockedUntil).toBeNull();
  });

  it("resets on success", () => {
    expect(registerSuccess()).toEqual(fresh);
  });

  it("requires a captcha after 3 failures", () => {
    expect(CAPTCHA_AFTER_FAILURES).toBe(3);
    expect(captchaRequired(failTimes(2).state)).toBe(false);
    expect(captchaRequired(failTimes(3).state)).toBe(true);
  });
});
