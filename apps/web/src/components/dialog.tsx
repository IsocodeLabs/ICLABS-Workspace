"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Btn } from "./admin";

/** Native <dialog> modal: focus trap, Esc to close and backdrop come for free. */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  tone = "default",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  tone?: "default" | "danger";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-card border border-border bg-surface p-0 text-text shadow-card backdrop:bg-black/40"
    >
      <div
        className={`border-t-4 p-6 ${tone === "danger" ? "border-danger-fg" : "border-brand-500"}`}
      >
        <h2 className="font-display text-xl font-bold">{title}</h2>
        <div className="mt-3">{children}</div>
        {footer && <div className="mt-6 flex justify-end gap-2">{footer}</div>}
      </div>
    </dialog>
  );
}

/** Every destructive action goes through this: the danger is visible before the click. */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      tone="danger"
      footer={
        <>
          <Btn variant="secondary" onClick={onCancel}>
            Cancel
          </Btn>
          <Btn variant="danger" onClick={onConfirm}>
            {confirmLabel}
          </Btn>
        </>
      }
    >
      <div className="text-muted">{body}</div>
    </Dialog>
  );
}
