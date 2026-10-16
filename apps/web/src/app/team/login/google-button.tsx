"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

export function GoogleButton({ label }: { label: string }) {
  const [pending, setPending] = useState(false);
  return (
    <Button
      type="button"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await authClient.signIn.social({
          provider: "google",
          callbackURL: "/team",
          errorCallbackURL: "/team/login?error=not_allowed",
        });
      }}
    >
      {label}
    </Button>
  );
}
