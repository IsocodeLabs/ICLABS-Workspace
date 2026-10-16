import "server-only";
import { env } from "../env";
import { createFakeCalendar, createGoogleCalendar, type CalendarClient } from "../calendar";
import { progressionDeps } from "../stages/deps";
import type { InterviewDeps } from ".";

let calendar: CalendarClient | undefined;

function calendarClient(): CalendarClient {
  if (!calendar) {
    const e = env();
    if (e.CALENDAR_DRIVER === "google") {
      if (!e.CALENDAR_SA_EMAIL || !e.CALENDAR_SA_KEY)
        throw new Error("CALENDAR_SA_EMAIL and CALENDAR_SA_KEY are required when CALENDAR_DRIVER=google");
      calendar = createGoogleCalendar({
        serviceAccountEmail: e.CALENDAR_SA_EMAIL,
        privateKey: e.CALENDAR_SA_KEY.replace(/\n/g, "\n"),
        organizer: e.CALENDAR_ORGANIZER,
      });
    } else {
      if (e.NODE_ENV === "production") throw new Error("The fake calendar is for development only");
      calendar = createFakeCalendar();
    }
  }
  return calendar;
}

export function interviewDeps(): InterviewDeps {
  return { ...progressionDeps(), calendar: calendarClient(), organizerEmail: env().CALENDAR_ORGANIZER };
}
