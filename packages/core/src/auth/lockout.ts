export const MAX_FAILED_ATTEMPTS = 10;
export const LOCK_DURATION_MS = 15 * 60 * 1000;
export const CAPTCHA_AFTER_FAILURES = 3;

export type LoginState = { failedCount: number; lockedUntil: Date | null };

export function isLocked(state: LoginState, now: Date): boolean {
  return state.lockedUntil !== null && now.getTime() < state.lockedUntil.getTime();
}

/** Records a wrong password. A lock that has run out starts a fresh count. */
export function registerFailure(
  state: LoginState,
  now: Date,
): { state: LoginState; justLocked: boolean } {
  const lockExpired = state.lockedUntil !== null && !isLocked(state, now);
  const failedCount = (lockExpired ? 0 : state.failedCount) + 1;
  if (failedCount >= MAX_FAILED_ATTEMPTS) {
    return {
      state: { failedCount, lockedUntil: new Date(now.getTime() + LOCK_DURATION_MS) },
      justLocked: true,
    };
  }
  return { state: { failedCount, lockedUntil: null }, justLocked: false };
}

export function registerSuccess(): LoginState {
  return { failedCount: 0, lockedUntil: null };
}

export function captchaRequired(state: LoginState): boolean {
  return state.failedCount >= CAPTCHA_AFTER_FAILURES;
}
