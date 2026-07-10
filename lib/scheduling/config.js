const DEFAULT_CALENDLY_LINK = "https://calendly.com/abhishek-llmaudit/30min";

function optional(name, fallback = "") {
  return process.env[name] ?? fallback;
}

/** Normalize booking URLs (strip trailing slashes and Calendly month suffix). */
export function normalizeBookingLink(url) {
  if (!url || typeof url !== "string") return "";
  return url.trim().replace(/\?month\/?$/i, "").replace(/\/$/, "");
}

/** Normalize Calendly URL (strip trailing ?month, slashes). */
export function normalizeCalendlyLink(url) {
  if (!url || typeof url !== "string") return DEFAULT_CALENDLY_LINK;
  return normalizeBookingLink(url) || DEFAULT_CALENDLY_LINK;
}

export function getSchedulingConfig() {
  const rawMode = optional("SCHEDULING_MODE", "calendly").toLowerCase();
  return {
    mode: rawMode === "gcal" ? "gcal" : "calendly",
    calendlyLink: normalizeCalendlyLink(optional("CALENDLY_LINK", DEFAULT_CALENDLY_LINK)),
    heyreachBookingLink: normalizeBookingLink(optional("HEYREACH_BOOKING_LINK", "")),
  };
}

/** Gmail scheduling link (Calendly). */
export function getGmailCalendlyLink() {
  return getSchedulingConfig().calendlyLink;
}

/** HeyReach / LinkedIn scheduling link (separate from Calendly). */
export function getHeyReachBookingLink() {
  return getSchedulingConfig().heyreachBookingLink;
}

export function isCalendlySchedulingMode() {
  return getSchedulingConfig().mode === "calendly";
}

export function isGoogleCalendarSchedulingMode() {
  return getSchedulingConfig().mode === "gcal";
}

/** Timezone/duration defaults for scheduling intent parsing (Calendly mode). */
export function getSchedulingDefaults() {
  return {
    timezone: optional("GOOGLE_CALENDAR_TIMEZONE", "Asia/Kolkata"),
    defaultDurationMin: Number(optional("GOOGLE_CALENDAR_DURATION_MIN", "30")),
  };
}
