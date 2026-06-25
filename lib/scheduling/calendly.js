import { getSchedulingConfig, normalizeCalendlyLink } from "./config.js";

export function buildCalendlyScheduling(link) {
  const calendlyLink = normalizeCalendlyLink(link || getSchedulingConfig().calendlyLink);
  return {
    intent: true,
    mode: "calendly",
    status: "calendly_link_sent",
    calendlyLink,
    requestedTime: null,
    proposedSlots: [],
    pendingBook: null,
    calendarEventId: null,
    meetLink: null,
    calendarError: null,
  };
}

/** Append Calendly link once; skip if URL already present in reply. */
export function appendCalendlyLinkToReply(reply, link) {
  const text = (reply || "").trim();
  if (!text) return text;

  const calendlyLink = normalizeCalendlyLink(link || getSchedulingConfig().calendlyLink);
  if (text.includes(calendlyLink) || /calendly\.com/i.test(text)) {
    return text;
  }

  return `${text}\n\nGrab a time that works: ${calendlyLink}`;
}
