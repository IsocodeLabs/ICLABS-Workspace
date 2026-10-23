"use client";

import { Select } from "@/components/admin";

export function TrackPicker({
  value,
  options,
}: {
  value: string;
  options: { id: string; label: string }[];
}) {
  return (
    <Select
      aria-label="Track"
      value={value}
      // A full load, so the board always shows the picked track (a soft navigation could keep
      // the previous board on screen).
      onChange={(e) =>
        window.location.assign(`/team/pipeline?track=${encodeURIComponent(e.target.value)}`)
      }
      className="min-w-80"
    >
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}
