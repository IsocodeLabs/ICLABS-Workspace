/**
 * Google Calendar for interviews: free/busy checks across the panel, and one event per
 * interview with an auto-generated Meet link. Rescheduling patches the same event.
 *
 * Production uses a service account with domain-wide delegation for the calendar scope,
 * acting as a scheduling mailbox (e.g. hiring@isocodelabs.com) that organises every event.
 * See docs/TDD.md → Interviews. Development and tests use the in-memory fake.
 */

export type BusyWindow = { start: Date; end: Date };

export type EventInput = {
  summary: string;
  description: string;
  start: Date;
  end: Date;
  /** Team members and the candidate. Google sends nothing; our own email carries the .ics. */
  attendees: string[];
  withMeet: boolean;
  location?: string;
};

export interface CalendarClient {
  /** Busy windows per email address between `from` and `to`. */
  freeBusy(emails: string[], from: Date, to: Date): Promise<Record<string, BusyWindow[]>>;
  createEvent(input: EventInput & { requestId: string }): Promise<{ eventId: string; meetUrl: string | null }>;
  updateEvent(eventId: string, input: EventInput): Promise<{ meetUrl: string | null }>;
  cancelEvent(eventId: string): Promise<void>;
}

export const overlaps = (a: BusyWindow, b: BusyWindow) => a.start < b.end && b.start < a.end;

/** Which panel members are busy during the slot (empty when everyone is free). */
export async function conflictsFor(calendar: CalendarClient, emails: string[], slot: BusyWindow) {
  const busy = await calendar.freeBusy(emails, slot.start, slot.end);
  return emails.filter((e) => (busy[e] ?? []).some((w) => overlaps(w, slot)));
}

const API = "https://www.googleapis.com/calendar/v3";

export function createGoogleCalendar(opts: {
  serviceAccountEmail: string;
  privateKey: string;
  /** The mailbox that organises events (domain-wide delegation subject). */
  organizer: string;
}): CalendarClient {
  let tokenCache: { token: string; exp: number } | undefined;
  async function token() {
    if (tokenCache && tokenCache.exp > Date.now() + 60_000) return tokenCache.token;
    const { JWT } = await import("google-auth-library");
    const jwt = new JWT({
      email: opts.serviceAccountEmail,
      key: opts.privateKey,
      subject: opts.organizer,
      scopes: ["https://www.googleapis.com/auth/calendar"],
    });
    const { token: t } = await jwt.getAccessToken();
    if (!t) throw new Error("calendar: no access token");
    tokenCache = { token: t, exp: Date.now() + 50 * 60_000 };
    return t;
  }
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 204 || res.status === 410) return undefined as T;
    if (!res.ok) throw new Error(`calendar ${method} ${path.split("?")[0]} → ${res.status}`);
    return (await res.json()) as T;
  }
  const cal = `/calendars/${encodeURIComponent(opts.organizer)}/events`;
  const eventBody = (input: EventInput) => ({
    summary: input.summary,
    description: input.description,
    location: input.location,
    start: { dateTime: input.start.toISOString(), timeZone: "Asia/Kolkata" },
    end: { dateTime: input.end.toISOString(), timeZone: "Asia/Kolkata" },
    attendees: input.attendees.map((email) => ({ email })),
    guestsCanSeeOtherGuests: false,
    reminders: { useDefault: true },
  });
  type GEvent = { id: string; hangoutLink?: string; conferenceData?: { entryPoints?: { entryPointType: string; uri: string }[] } };
  const meetOf = (e: GEvent) => e.hangoutLink ?? e.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri ?? null;

  return {
    async freeBusy(emails, from, to) {
      const res = await call<{ calendars: Record<string, { busy: { start: string; end: string }[] }> }>("POST", "/freeBusy", {
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
        timeZone: "Asia/Kolkata",
        items: emails.map((id) => ({ id })),
      });
      return Object.fromEntries(
        emails.map((e) => [e, (res.calendars[e]?.busy ?? []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) }))]),
      );
    },
    async createEvent(input) {
      const body = {
        ...eventBody(input),
        ...(input.withMeet
          ? { conferenceData: { createRequest: { requestId: input.requestId, conferenceSolutionKey: { type: "hangoutsMeet" } } } }
          : {}),
      };
      const e = await call<GEvent>("POST", `${cal}?conferenceDataVersion=1&sendUpdates=none`, body);
      return { eventId: e.id, meetUrl: meetOf(e) };
    },
    async updateEvent(eventId, input) {
      const e = await call<GEvent>("PATCH", `${cal}/${encodeURIComponent(eventId)}?conferenceDataVersion=1&sendUpdates=none`, eventBody(input));
      return { meetUrl: meetOf(e) };
    },
    async cancelEvent(eventId) {
      await call("DELETE", `${cal}/${encodeURIComponent(eventId)}?sendUpdates=none`);
    },
  };
}

/** In-memory calendar for development and tests. Busy windows can be seeded per email. */
export function createFakeCalendar(seed: Record<string, BusyWindow[]> = {}) {
  const busy = new Map(Object.entries(seed));
  const events = new Map<string, EventInput>();
  const meet = new Map<string, string | null>();
  let n = 0;
  const client: CalendarClient & { events: typeof events; busy: typeof busy } = {
    events,
    busy,
    async freeBusy(emails, from, to) {
      const window = { start: from, end: to };
      const out: Record<string, BusyWindow[]> = {};
      for (const e of emails) {
        const own = (busy.get(e) ?? []).filter((w) => overlaps(w, window));
        const booked = [...events.values()]
          .filter((ev) => ev.attendees.includes(e))
          .map((ev) => ({ start: ev.start, end: ev.end }))
          .filter((w) => overlaps(w, window));
        out[e] = [...own, ...booked];
      }
      return out;
    },
    async createEvent(input) {
      const eventId = `evt_${++n}`;
      events.set(eventId, input);
      meet.set(eventId, input.withMeet ? `https://meet.google.com/fake-${n}` : null);
      return { eventId, meetUrl: meet.get(eventId)! };
    },
    async updateEvent(eventId, input) {
      events.set(eventId, input);
      return { meetUrl: meet.get(eventId) ?? null };
    },
    async cancelEvent(eventId) {
      events.delete(eventId);
    },
  };
  return client;
}
