"use client";

import { ErrorScreen } from "@/components/error-screen";

/** Every team page, including team sign-in. */
export default function TeamError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorScreen error={error} reset={reset} where="boundary:team" />;
}
