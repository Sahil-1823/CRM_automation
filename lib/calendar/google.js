import { getGoogleCalendarConfig } from "./config.js";
import { getGoogleOAuthTokens, saveGoogleOAuthTokens } from "./store.js";
import { findOpenSlots, slotOverlapsBusy } from "./slots.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export async function exchangeCodeForTokens({ code, redirectUri }) {
  const { clientId, clientSecret } = getGoogleCalendarConfig();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token exchange failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

export async function refreshAccessToken(refreshToken) {
  const { clientId, clientSecret } = getGoogleCalendarConfig();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token refresh failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

export async function fetchGoogleUserEmail(accessToken) {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.email || null;
}

export async function getValidAccessToken() {
  const stored = await getGoogleOAuthTokens();
  if (!stored?.refreshToken) {
    throw new Error("Google Calendar is not connected");
  }

  const now = Date.now();
  if (stored.accessToken && stored.expiresAt && stored.expiresAt > now + 60_000) {
    return stored.accessToken;
  }

  const refreshed = await refreshAccessToken(stored.refreshToken);
  const accessToken = refreshed.access_token;
  const expiresAt = Date.now() + (refreshed.expires_in || 3600) * 1000;
  await saveGoogleOAuthTokens({
    ...stored,
    accessToken,
    expiresAt,
  });
  return accessToken;
}

async function calendarFetch(path, { method = "GET", body, query = {} } = {}) {
  const accessToken = await getValidAccessToken();
  const qs = new URLSearchParams(query).toString();
  const url = `${CALENDAR_API}${path}${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`Google Calendar API ${method} ${path} failed (${res.status}): ${await res.text()}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

/** Extract Google Meet join URL from a created/updated calendar event. */
export function extractMeetLink(event) {
  if (!event || typeof event !== "object") return null;
  if (event.hangoutLink) return event.hangoutLink;

  const entryPoints = event.conferenceData?.entryPoints || [];
  const video = entryPoints.find((ep) => ep.entryPointType === "video");
  if (video?.uri) return video.uri;

  return entryPoints[0]?.uri || null;
}

export async function queryFreeBusy({ timeMin, timeMax }) {
  const { calendarId } = getGoogleCalendarConfig();
  const data = await calendarFetch("/freeBusy", {
    method: "POST",
    body: {
      timeMin,
      timeMax,
      items: [{ id: calendarId }],
    },
  });
  const busy = data?.calendars?.[calendarId]?.busy || [];
  return busy.map((b) => ({ start: b.start, end: b.end }));
}

export async function checkSlotAvailability({ start, end }) {
  const busy = await queryFreeBusy({ timeMin: start, timeMax: end });
  const slot = { start, end };
  return {
    available: !slotOverlapsBusy(slot, busy),
    busy,
  };
}

export async function findAvailableSlots({ from, to, durationMin, maxSlots = 3 } = {}) {
  const config = getGoogleCalendarConfig();
  const timeMin = (from || new Date()).toISOString();
  const timeMax = (
    to ||
    new Date(Date.now() + config.slotSearchDays * 24 * 60 * 60 * 1000)
  ).toISOString();
  const busy = await queryFreeBusy({ timeMin, timeMax });
  return findOpenSlots({
    from: new Date(timeMin),
    to: new Date(timeMax),
    durationMin: durationMin || config.defaultDurationMin,
    busy,
    timeZone: config.timezone,
    workStartHour: config.workingHoursStart,
    workEndHour: config.workingHoursEnd,
    maxSlots,
  });
}

export async function createCalendarEvent({
  summary,
  description,
  start,
  end,
  attendees = [],
  addGoogleMeet,
}) {
  const { calendarId, timezone, addGoogleMeet: defaultAddMeet } = getGoogleCalendarConfig();
  const withMeet = addGoogleMeet ?? defaultAddMeet;
  const event = {
    summary,
    description,
    start: { dateTime: start, timeZone: timezone },
    end: { dateTime: end, timeZone: timezone },
  };
  const emails = attendees.filter(Boolean);
  if (emails.length) {
    event.attendees = emails.map((email) => ({ email }));
  }
  if (withMeet) {
    event.conferenceData = {
      createRequest: {
        requestId: crypto.randomUUID(),
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }

  const created = await calendarFetch(`/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: "POST",
    body: event,
    query: withMeet ? { conferenceDataVersion: "1" } : {},
  });

  return {
    ...created,
    meetLink: extractMeetLink(created),
  };
}
