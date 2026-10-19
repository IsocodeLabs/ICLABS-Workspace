"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Btn, Card, Field, Input } from "@/components/admin";
import { ConfirmDialog, Dialog } from "@/components/dialog";
import { Alert } from "@/components/ui";
import {
  createCycleAction,
  createRoleAction,
  createTrackAction,
  deleteRoleAction,
  updateRoleAction,
} from "../actions";

export function CreateRoleForm() {
  const [state, action, pending] = useActionState(createRoleAction, undefined);
  return (
    <Card className="mb-6">
      <h2 className="mb-4 font-display text-lg font-semibold">Add a role</h2>
      {state && !state.ok && <Alert>{state.error}</Alert>}
      {state?.ok && <Alert tone="success">Role added.</Alert>}
      <form action={action} className="grid gap-x-4 md:grid-cols-4">
        <Field label="Title" htmlFor="title">
          <Input id="title" name="title" placeholder="SDE Intern" required />
        </Field>
        <Field label="Short name" htmlFor="slug" hint="Used in links and CSV invites">
          <Input id="slug" name="slug" placeholder="sde" required />
        </Field>
        <Field label="Seats" htmlFor="seats">
          <Input id="seats" name="seats" type="number" min={0} placeholder="5" />
        </Field>
        <div className="flex items-start pt-6">
          <Btn type="submit" disabled={pending}>
            Add role
          </Btn>
        </div>
      </form>
    </Card>
  );
}

export function CreateCycleForm({ roleId }: { roleId: string }) {
  const [state, action, pending] = useActionState(createCycleAction, undefined);
  return (
    <form action={action} className="mt-4 flex gap-2">
      <input type="hidden" name="roleId" value={roleId} />
      <Input
        name="name"
        placeholder="New round, e.g. Winter 2026"
        aria-label="Round name"
        required
      />
      <Btn type="submit" variant="secondary" disabled={pending} className="shrink-0">
        Add round
      </Btn>
      {state && !state.ok && <span className="text-sm text-danger-fg">{state.error}</span>}
    </form>
  );
}

export function CreateTrackForm({ cycleId }: { cycleId: string }) {
  const [state, action, pending] = useActionState(createTrackAction, undefined);
  return (
    <form action={action} className="flex gap-2">
      <input type="hidden" name="cycleId" value={cycleId} />
      <Input name="name" placeholder="New track, e.g. Backend" aria-label="Track name" required />
      <Btn type="submit" variant="secondary" disabled={pending} className="shrink-0">
        Add track
      </Btn>
      {state && !state.ok && <span className="text-sm text-danger-fg">{state.error}</span>}
    </form>
  );
}

export function DeleteRoleButton({ roleId, title }: { roleId: string; title: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <Btn
        variant="ghost"
        size="sm"
        aria-label={`Delete ${title}`}
        title="Delete role"
        disabled={pending}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        <Trash2 size={16} aria-hidden />
      </Btn>
      {error && <p className="text-sm text-danger-fg">{error}</p>}
      <ConfirmDialog
        open={open}
        title={`Delete "${title}"?`}
        body="Its rounds, tracks and processes are deleted too. This can't be undone. Roles that candidates have applied to can't be deleted."
        confirmLabel="Delete role"
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          setOpen(false);
          start(async () => {
            const res = await deleteRoleAction(roleId);
            if (!res.ok) setError(res.error);
          });
        }}
      />
    </>
  );
}

export function EditRoleButton({
  role,
}: {
  role: { id: string; title: string; slug: string; seats: number | null };
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(updateRoleAction, undefined);
  useEffect(() => {
    if (state?.ok) setOpen(false);
  }, [state]);
  return (
    <>
      <Btn
        variant="ghost"
        size="sm"
        aria-label={`Edit ${role.title}`}
        title="Edit role"
        onClick={() => setOpen(true)}
      >
        <Pencil size={16} aria-hidden />
      </Btn>
      <Dialog open={open} onClose={() => setOpen(false)} title="Edit role">
        {state && !state.ok && <Alert>{state.error}</Alert>}
        <form action={action}>
          <input type="hidden" name="roleId" value={role.id} />
          <Field label="Title" htmlFor={`title-${role.id}`}>
            <Input id={`title-${role.id}`} name="title" defaultValue={role.title} required />
          </Field>
          <Field
            label="Short name"
            htmlFor={`slug-${role.id}`}
            hint="Changing it changes the role's links and CSV invite name"
          >
            <Input id={`slug-${role.id}`} name="slug" defaultValue={role.slug} required />
          </Field>
          <Field label="Seats" htmlFor={`seats-${role.id}`}>
            <Input
              id={`seats-${role.id}`}
              name="seats"
              type="number"
              min={0}
              defaultValue={role.seats ?? ""}
            />
          </Field>
          <div className="mt-6 flex justify-end gap-2">
            <Btn type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Btn>
            <Btn type="submit" disabled={pending}>
              Save
            </Btn>
          </div>
        </form>
      </Dialog>
    </>
  );
}
