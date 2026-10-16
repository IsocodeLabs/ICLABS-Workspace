"use client";

import { useRouter } from "next/navigation";
import { Select } from "@/components/admin";

export function TrackPicker({ value, options }: { value: string; options: { id: string; label: string }[] }) {
  const router = useRouter();
  return (
    <Select
      aria-label="Track"
      value={value}
      onChange={(e) => router.push(`/team/pipeline?track=${encodeURIComponent(e.target.value)}`)}
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
