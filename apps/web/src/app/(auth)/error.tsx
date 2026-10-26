"use client";

import { ErrorScreen } from "@/components/error-screen";

/** Sign-in, password and welcome pages. */
export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorScreen error={error} reset={reset} where="boundary:auth" />;
}
