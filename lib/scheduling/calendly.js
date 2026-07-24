import { getSchedulingConfig, normalizeCalendlyLink } from "./config.js";
import { conversationContainsBookingLink, conversationHasBookingOffer } from "./booking-link.js";

export function buildCalendlyScheduling(link, { conversation = [] } = {}) {
  const calendlyLink = normalizeCalendlyLink(link || getSchedulingConfig().calendlyLink);
  const alreadyOffered =
    conversationContainsBookingLink(conversation, calendlyLink) ||
    conversationHasBookingOffer(conversation, calendlyLink) ||
    (conversation || []).some((m) => /calendly\.com/i.test(m?.text || ""));
  const lastFromUs =
    [...(conversation || [])].reverse().find((m) => m?.from === "lead" || m?.from === "us")
      ?.from === "us";

  return {
    intent: true,
    mode: "calendly",
    channel: "gmail",
    status: alreadyOffered ? "calendly_already_in_thread" : "calendly_link_sent",
    calendlyLink,
    alreadyOffered,
    appendLink: !alreadyOffered,
    waitingOnLead: alreadyOffered || lastFromUs,
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
