"use client";

import { useState, useTransition } from "react";
import { Btn } from "@/components/admin";
import { ConfirmDialog } from "@/components/dialog";
import { revokeGrantAction, setMcpEnabledAction } from "./actions";

export function KillSwitch({ enabled }: { enabled: boolean }) {
  const [pending, start] = useTransition();
  return (
    <Btn
      variant={enabled ? "danger" : "primary"}
      disabled={pending}
      onClick={() => start(() => setMcpEnabledAction(!enabled))}
    >
      {enabled ? "Turn off for everyone" : "Turn on"}
    </Btn>
  );
}

export function RevokeGrant({ grantId, label }: { grantId: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <>
      <Btn
        size="sm"
        variant="ghost"
        className="text-danger-fg"
        disabled={pending}
        onClick={() => setOpen(true)}
      >
        Revoke
      </Btn>
      <ConfirmDialog
        open={open}
        title={`Disconnect ${label}?`}
        body="Its tokens stop working immediately. Reconnecting needs a fresh sign-in."
        confirmLabel="Revoke"
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          setOpen(false);
          start(() => revokeGrantAction(grantId));
        }}
      />
    </>
  );
}
