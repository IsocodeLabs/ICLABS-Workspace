"use client";

import { useState, useTransition } from "react";
import { Btn } from "@/components/admin";
import { ConfirmDialog } from "@/components/dialog";
import { eraseCandidateAction, resendInviteAction, revokeApplicationAction } from "../actions";

export function CandidateActions({ candidateId }: { candidateId: string }) {
  const [open, setOpen] = useState(false);
  const [erase, setErase] = useState(false);
  const [eraseError, setEraseError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <Btn
        variant="ghost"
        className="text-danger-fg"
        disabled={pending}
        onClick={() => setErase(true)}
      >
        Delete all data
      </Btn>
      {eraseError && <p className="text-sm text-danger-fg">{eraseError}</p>}
      <ConfirmDialog
        open={erase}
        title="Delete everything about this candidate?"
        body="Use this for a data-deletion request. Their account, applications, submissions, files, reviews, interviews and emails are permanently erased. This can't be undone. The audit log keeps a record that it happened, without personal details."
        confirmLabel="Delete permanently"
        onCancel={() => setErase(false)}
        onConfirm={() => {
          setErase(false);
          setEraseError(null);
          start(async () => {
            const res = await eraseCandidateAction(candidateId);
            if (res && !res.ok) setEraseError(res.error);
          });
        }}
      />
      <Btn variant="secondary" disabled={pending} onClick={() => setOpen(true)}>
        Resend invite
      </Btn>
      <ConfirmDialog
        open={open}
        title="Send a new temporary password?"
        body="Their current temporary password (or chosen password) stops working, and they get a new welcome email valid for 72 hours."
        confirmLabel="Resend invite"
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          setOpen(false);
          start(() => resendInviteAction(candidateId));
        }}
      />
    </>
  );
}

export function RevokeButton({
  applicationId,
  candidateId,
  role,
}: {
  applicationId: string;
  candidateId: string;
  role: string;
}) {
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
        Remove role
      </Btn>
      <ConfirmDialog
        open={open}
        title={`Remove ${role}?`}
        body="They lose access to this role straight away. No email is sent. Their other roles are not affected."
        confirmLabel="Remove role"
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          setOpen(false);
          start(() => revokeApplicationAction(applicationId, candidateId));
        }}
      />
    </>
  );
}
