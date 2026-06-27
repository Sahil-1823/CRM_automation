const DEFAULT_CALENDLY_LINK = "https://calendly.com/abhishek-llmaudit/30min";

function optional(name, fallback = "") {
  return process.env[name] ?? fallback;
}

export function normalizeCalendlyLink(url) {
  if (!url || typeof url !== "string") return DEFAULT_CALENDLY_LINK;
  return url.trim().replace(/\?month\/?$/i, "").replace(/\/$/, "");
}

export function getSchedulingConfig() {
  const rawMode = optional("SCHEDULING_MODE", "calendly").toLowerCase();
  return {
    mode: rawMode === "gcal" ? "gcal" : "calendly",
    calendlyLink: normalizeCalendlyLink(optional("CALENDLY_LINK", DEFAULT_CALENDLY_LINK)),
  };
}

export function isCalendlySchedulingMode() {
  return getSchedulingConfig().mode === "calendly";
}

export function isGoogleCalendarSchedulingMode() {
  return getSchedulingConfig().mode === "gcal";
}
