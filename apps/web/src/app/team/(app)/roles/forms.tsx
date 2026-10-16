"use client";

import { useActionState } from "react";
import { Btn, Card, Field, Input } from "@/components/admin";
import { Alert } from "@/components/ui";
import { createCycleAction, createRoleAction, createTrackAction } from "../actions";

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
