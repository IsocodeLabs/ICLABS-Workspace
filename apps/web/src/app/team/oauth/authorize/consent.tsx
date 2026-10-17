"use client";

import { useTransition } from "react";
import { Btn } from "@/components/admin";
import { decideAuthorization } from "./actions";

export function Consent({ params }: { params: Record<string, string> }) {
  const [pending, start] = useTransition();
  return (
    <div className="mt-6 flex justify-end gap-2">
      <Btn variant="secondary" disabled={pending} onClick={() => start(() => decideAuthorization(params, false))}>
        Deny
      </Btn>
      <Btn variant="gradient" disabled={pending} onClick={() => start(() => decideAuthorization(params, true))}>
        {pending ? "Connecting…" : "Allow"}
      </Btn>
    </div>
  );
}
