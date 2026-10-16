"use client";

import { useState, useTransition } from "react";
import { Btn, Card, Input, TextArea } from "@/components/admin";
import { ConfirmDialog } from "@/components/dialog";
import { Alert, StatusPill } from "@/components/ui";
import type { TemplateKey } from "@/server/email/templates";
import { resetEmailTemplateAction, saveEmailTemplateAction } from "../../candidates/actions";

export function TemplateEditor({
  template,
}: {
  template: {
    key: TemplateKey;
    description: string;
    subject: string;
    body: string;
    customised: boolean;
  };
}) {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState(template.subject);
  const [body, setBody] = useState(template.body);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [pending, start] = useTransition();
  const vars = [
    ...new Set([...`${subject}\n${body}`.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1])),
  ];

  return (
    <Card className="p-0">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-6 py-4 text-left"
      >
        <div>
          <div className="font-semibold">{template.description}</div>
          <div className="text-sm text-muted">{subject}</div>
        </div>
        <StatusPill tone={template.customised ? "success" : "neutral"}>
          {template.customised ? "Customised" : "Default"}
        </StatusPill>
      </button>
      {open && (
        <div className="border-t border-border px-6 py-5">
          {message && <Alert tone={message.ok ? "success" : "danger"}>{message.text}</Alert>}
          <label className="mb-3 block">
            <span className="mb-1 block text-sm font-semibold">Subject</span>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />
          </label>
          <label className="mb-3 block">
            <span className="mb-1 block text-sm font-semibold">Body</span>
            <TextArea
              className="min-h-56 font-mono text-sm"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </label>
          <p className="mb-4 text-xs text-muted">
            Variables used: {vars.map((v) => `{{${v}}}`).join(" ") || "none"}
          </p>
          <div className="flex gap-2">
            <Btn
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await saveEmailTemplateAction(template.key, subject, body);
                  setMessage(
                    res.ok
                      ? { ok: true, text: "Saved. New emails use this wording." }
                      : { ok: false, text: res.error },
                  );
                })
              }
            >
              Save
            </Btn>
            {template.customised && (
              <Btn variant="secondary" disabled={pending} onClick={() => setConfirmReset(true)}>
                Reset to default
              </Btn>
            )}
          </div>
          <ConfirmDialog
            open={confirmReset}
            title="Reset to the default wording?"
            body="Your custom subject and body for this email are deleted."
            confirmLabel="Reset"
            onCancel={() => setConfirmReset(false)}
            onConfirm={() => {
              setConfirmReset(false);
              start(() => resetEmailTemplateAction(template.key));
            }}
          />
        </div>
      )}
    </Card>
  );
}
