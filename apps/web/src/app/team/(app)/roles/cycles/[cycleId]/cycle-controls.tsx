"use client";

import { useState, useTransition } from "react";
import { Btn, Input, Select } from "@/components/admin";
import { Dialog } from "@/components/dialog";
import { cloneCycleAction, setCycleStatusAction } from "../../../actions";

type Status = "draft" | "open" | "closed" | "archived";

export function CycleControls({
  cycleId,
  status,
  isAdmin,
}: {
  cycleId: string;
  status: Status;
  isAdmin: boolean;
}) {
  const [cloneOpen, setCloneOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  return (
    <>
      {isAdmin && (
        <Select
          aria-label="Round status"
          value={status}
          disabled={pending}
          onChange={(e) => start(() => setCycleStatusAction(cycleId, e.target.value as Status))}
          className="w-36"
        >
          <option value="draft">Draft</option>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
          <option value="archived">Archived</option>
        </Select>
      )}
      <Btn variant="secondary" onClick={() => setCloneOpen(true)}>
        Clone as new round
      </Btn>
      <Dialog
        open={cloneOpen}
        onClose={() => setCloneOpen(false)}
        title="Clone this round"
        footer={
          <>
            <Btn variant="secondary" onClick={() => setCloneOpen(false)}>
              Cancel
            </Btn>
            <Btn
              disabled={pending || name.trim().length < 2}
              onClick={() => start(() => cloneCycleAction(cycleId, name))}
            >
              Clone
            </Btn>
          </>
        }
      >
        <p className="mb-3 text-muted">
          Copies every track's process into a new draft round. Candidates are not copied.
        </p>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Summer 2027"
          aria-label="New round name"
        />
      </Dialog>
    </>
  );
}
