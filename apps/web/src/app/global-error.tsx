"use client";

import { ErrorScreen } from "@/components/error-screen";
import "./globals.css";

/** Last resort: the root layout itself failed. Replaces it, so it renders <html> itself. */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en">
      <body>
        <ErrorScreen error={error} where="boundary:root" />
      </body>
    </html>
  );
}
