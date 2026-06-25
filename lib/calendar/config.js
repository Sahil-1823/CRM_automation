function optional(name, fallback = "") {
  return process.env[name] ?? fallback;
}

export function getGoogleCalendarConfig() {
  return {
    clientId: optional("GOOGLE_CLIENT_ID"),
    clientSecret: optional("GOOGLE_CLIENT_SECRET"),
    calendarId: optional("GOOGLE_CALENDAR_ID", "primary"),
    timezone: optional("GOOGLE_CALENDAR_TIMEZONE", "Asia/Kolkata"),
    workingHoursStart: Number(optional("GOOGLE_CALENDAR_WORK_START", "10")),
    workingHoursEnd: Number(optional("GOOGLE_CALENDAR_WORK_END", "18")),
    defaultDurationMin: Number(optional("GOOGLE_CALENDAR_DURATION_MIN", "30")),
    slotSearchDays: Number(optional("GOOGLE_CALENDAR_SLOT_DAYS", "7")),
    addGoogleMeet: optional("GOOGLE_CALENDAR_ADD_MEET", "true") === "true",
  };
}

export function isGoogleOAuthConfigured() {
  const { clientId, clientSecret } = getGoogleCalendarConfig();
  return Boolean(clientId && clientSecret);
}

export function getGoogleRedirectUri(req) {
  if (process.env.GOOGLE_REDIRECT_URI) {
    return process.env.GOOGLE_REDIRECT_URI;
  }
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost:3000";
  const proto = req.headers["x-forwarded-proto"] || (host.includes("localhost") ? "http" : "https");
  return `${proto}://${host}/api/auth/google?action=callback`;
}

export const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
