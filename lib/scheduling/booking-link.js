import { getHeyReachBookingLink, normalizeBookingLink } from "./config.js";

export function buildHeyReachBookingScheduling(link) {
  const bookingLink = normalizeBookingLink(link || getHeyReachBookingLink());
  return {
    intent: true,
    mode: "booking_link",
    channel: "heyreach",
    status: bookingLink ? "booking_link_sent" : "booking_link_missing",
    bookingLink,
    requestedTime: null,
    proposedSlots: [],
    pendingBook: null,
    calendarEventId: null,
    meetLink: null,
    calendarError: bookingLink ? null : "HEYREACH_BOOKING_LINK is not configured",
  };
}

/** Append HeyReach booking link once; skip if URL already present in reply. */
export function appendBookingLinkToReply(reply, link, { suffix = "Grab a time that works" } = {}) {
  const text = (reply || "").trim();
  if (!text) return text;

  const bookingLink = normalizeBookingLink(link || getHeyReachBookingLink());
  if (!bookingLink) return text;
  if (text.includes(bookingLink)) return text;

  return `${text}\n\n${suffix}: ${bookingLink}`;
}
