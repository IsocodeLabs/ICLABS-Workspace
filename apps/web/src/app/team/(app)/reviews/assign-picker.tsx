"use client";

import { useState, useTransition } from "react";
import { Btn, Select } from "@/components/admin";
import { assignReviewerAction } from "./actions";

export function AssignPicker({
  progressId,
  reviewers,
}: {
  progressId: string;
  reviewers: { id: string; email: string }[];
}) {
  const [who, setWho] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-2">
      <Select
        aria-label="Reviewer"
        value={who}
        onChange={(e) => setWho(e.target.value)}
        className="w-60"
      >
        <option value="">Choose a reviewer…</option>
        {reviewers.map((r) => (
          <option key={r.id} value={r.id}>
            {r.email}
          </option>
        ))}
      </Select>
      <Btn
        size="sm"
        disabled={!who || pending}
        onClick={() =>
          start(async () => {
            const res = await assignReviewerAction(progressId, who);
            setError(res.ok ? null : res.error);
          })
        }
      >
        Assign
      </Btn>
      {error && <span role="alert" className="text-sm text-danger-fg">{error}</span>}
    </div>
  );
}
