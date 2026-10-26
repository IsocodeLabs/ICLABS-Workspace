"use client";

import { ErrorScreen } from "@/components/error-screen";

/** Anything unexpected on a candidate page lands here instead of a blank error. */
export default function CandidateError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorScreen error={error} reset={reset} where="boundary:candidate" />;
}
