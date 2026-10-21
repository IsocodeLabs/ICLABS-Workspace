import "server-only";
import { env } from "../env";
import { createFakeCalendar, createGoogleCalendar, type CalendarClient } from "../calendar";
import { progressionDeps } from "../stages/deps";
import type { InterviewDeps } from ".";

let calendar: CalendarClient | null | undefined;

/**
 * Google Calendar when it's configured; the in-memory fake in development; otherwise null, and
 * interviews book without calendar events instead of failing (see scheduleInterview).
 */
function calendarClient(): CalendarClient | null {
  if (calendar === undefined) {
    const e = env();
    if (e.CALENDAR_DRIVER === "google" && e.CALENDAR_SA_EMAIL && e.CALENDAR_SA_KEY) {
      calendar = createGoogleCalendar({
        serviceAccountEmail: e.CALENDAR_SA_EMAIL,
        // Secret Manager and .env files usually hold the PEM with literal \n escapes.
        privateKey: e.CALENDAR_SA_KEY.replace(/\\n/g, "\n"),
        organizer: e.CALENDAR_ORGANIZER,
      });
    } else if (e.CALENDAR_DRIVER === "fake" && e.NODE_ENV !== "production") {
      calendar = createFakeCalendar();
    } else {
      console.warn(
        "[interviews] Google Calendar isn't connected (needs CALENDAR_DRIVER=google, CALENDAR_SA_EMAIL and CALENDAR_SA_KEY). Booking without calendar events.",
      );
      calendar = null;
    }
  }
  return calendar;
}

export function interviewDeps(): InterviewDeps {
  return { ...progressionDeps(), calendar: calendarClient(), organizerEmail: env().CALENDAR_ORGANIZER };
}
