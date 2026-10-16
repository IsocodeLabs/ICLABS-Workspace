"use client";

import { useActionState, useState, useTransition } from "react";
import { Btn, Card, Field, Input, Select } from "@/components/admin";
import { ConfirmDialog } from "@/components/dialog";
import { Alert, StatusPill } from "@/components/ui";
import { addTeamMemberAction, setAssignmentAction, updateTeamMemberAction } from "../../actions";

const ROLES = [
  ["admin", "Admin"],
  ["hiring_manager", "Hiring manager"],
  ["reviewer", "Reviewer"],
  ["interviewer", "Interviewer"],
] as const;
type Role = (typeof ROLES)[number][0];

export function AddMemberForm() {
  const [state, action, pending] = useActionState(addTeamMemberAction, undefined);
  return (
    <Card>
      <h2 className="mb-4 font-display text-lg font-semibold">Add a team member</h2>
      {state && !state.ok && <Alert>{state.error}</Alert>}
      {state?.ok && <Alert tone="success">Added. They can now sign in with Google.</Alert>}
      <form action={action} className="grid gap-x-4 md:grid-cols-[2fr_1fr_auto]">
        <Field label="Email" htmlFor="member-email">
          <Input
            id="member-email"
            name="email"
            type="email"
            placeholder="name@isocodelabs.com"
            required
          />
        </Field>
        <Field label="Role" htmlFor="member-role">
          <Select id="member-role" name="role" defaultValue="reviewer">
            {ROLES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="pt-6">
          <Btn type="submit" disabled={pending}>
            Add
          </Btn>
        </div>
      </form>
    </Card>
  );
}

export function MemberRow({
  member,
  roleOptions,
  assignedRoleIds,
}: {
  member: { id: string; email: string; role: Role; active: boolean; signedIn: boolean };
  roleOptions: { id: string; title: string }[];
  assignedRoleIds: string[];
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const update = (patch: { role?: Role; active?: boolean }) =>
    start(async () => {
      const r = await updateTeamMemberAction({ id: member.id, ...patch });
      setError(r.ok ? null : r.error);
    });

  return (
    <tr>
      <td className="px-5 py-3">
        <div className="font-medium">{member.email}</div>
        {!member.signedIn && <div className="text-sm text-muted">Hasn't signed in yet</div>}
        {error && <div className="text-sm text-danger-fg">{error}</div>}
      </td>
      <td className="px-5 py-3">
        <Select
          aria-label={`Role for ${member.email}`}
          value={member.role}
          disabled={pending}
          onChange={(e) => update({ role: e.target.value as Role })}
          className="w-44"
        >
          {ROLES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </td>
      <td className="px-5 py-3">
        {member.role === "hiring_manager" ? (
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {roleOptions.map((r) => (
              <label key={r.id} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  defaultChecked={assignedRoleIds.includes(r.id)}
                  onChange={(e) =>
                    start(() =>
                      setAssignmentAction({
                        teamMemberId: member.id,
                        scope: "role",
                        scopeId: r.id,
                        assigned: e.target.checked,
                      }),
                    )
                  }
                />
                {r.title}
              </label>
            ))}
          </div>
        ) : (
          <span className="text-sm text-muted">
            {member.role === "admin" ? "Everything" : "Assigned work only"}
          </span>
        )}
      </td>
      <td className="px-5 py-3">
        {member.active ? (
          <div className="flex items-center gap-2">
            <StatusPill tone="success">Active</StatusPill>
            <Btn size="sm" variant="ghost" onClick={() => setConfirmOff(true)} disabled={pending}>
              Remove access
            </Btn>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <StatusPill tone="neutral">Removed</StatusPill>
            <Btn
              size="sm"
              variant="ghost"
              onClick={() => update({ active: true })}
              disabled={pending}
            >
              Restore
            </Btn>
          </div>
        )}
        <ConfirmDialog
          open={confirmOff}
          title="Remove access?"
          body={`${member.email} won't be able to sign in. Their past reviews and notes stay.`}
          confirmLabel="Remove access"
          onCancel={() => setConfirmOff(false)}
          onConfirm={() => {
            setConfirmOff(false);
            update({ active: false });
          }}
        />
      </td>
    </tr>
  );
}
