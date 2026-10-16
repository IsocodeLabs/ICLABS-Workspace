/** RFC 5545 invite attached to our own interview emails (works with any calendar app). */
export function buildIcs(input: {
  uid: string;
  sequence: number;
  method: "REQUEST" | "CANCEL";
  start: Date;
  end: Date;
  summary: string;
  description: string;
  location: string;
  organizerEmail: string;
  attendeeEmail: string;
  now?: Date;
}): string {
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const text = (s: string) =>
    s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Isocode Labs//Workspace//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${input.method}`,
    "BEGIN:VEVENT",
    `UID:${input.uid}@workspace.isocodelabs.com`,
    `SEQUENCE:${input.sequence}`,
    `DTSTAMP:${stamp(input.now ?? new Date())}`,
    `DTSTART:${stamp(input.start)}`,
    `DTEND:${stamp(input.end)}`,
    `SUMMARY:${text(input.summary)}`,
    `DESCRIPTION:${text(input.description)}`,
    `LOCATION:${text(input.location)}`,
    `ORGANIZER;CN=Isocode Hiring:mailto:${input.organizerEmail}`,
    `ATTENDEE;ROLE=REQ-PARTICIPANT;RSVP=FALSE:mailto:${input.attendeeEmail}`,
    `STATUS:${input.method === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  // Fold lines longer than 75 octets.
  return lines
    .map((l) => (l.length <= 75 ? l : l.match(/.{1,74}/g)!.join("\r\n ")))
    .join("\r\n");
}
