import { getHeyReachBookingLink, normalizeBookingLink } from "./config.js";

/** Common booking URLs we may have already shared in-thread (not only env link). */
const BOOKING_URL_RE =
  /https?:\/\/(?:calendar\.app\.google|(?:www\.)?calendly\.com|(?:www\.)?cal\.com)\S*/i;

function conversationBlob(conversation) {
  return (conversation || [])
    .map((m) => (typeof m?.text === "string" ? m.text : ""))
    .join("\n");
}

/** True if an exact booking URL already appears anywhere in the thread. */
export function conversationContainsBookingLink(conversation, link) {
  const bookingLink = normalizeBookingLink(link || getHeyReachBookingLink());
  if (!bookingLink) return false;
  const blob = conversationBlob(conversation);
  if (blob.includes(bookingLink)) return true;
  // Match without trailing slash / query variants
  const bare = bookingLink.replace(/\/$/, "");
  return bare.length > 8 && blob.includes(bare);
}

/**
 * True if we already offered booking in this thread:
 * - configured HEYREACH link appears, or
 * - we previously sent a Google Calendar / Calendly / Cal.com link.
 */
export function conversationHasBookingOffer(conversation, link) {
  if (conversationContainsBookingLink(conversation, link)) return true;
  return (conversation || []).some(
    (m) => m?.from === "us" && BOOKING_URL_RE.test(m.text || ""),
  );
}

export function buildHeyReachBookingScheduling(link, { conversation = [] } = {}) {
  const bookingLink = normalizeBookingLink(link || getHeyReachBookingLink());
  const alreadyOffered = conversationHasBookingOffer(conversation, bookingLink);
  const lastFromUs =
    [...(conversation || [])].reverse().find((m) => m?.from === "lead" || m?.from === "us")
      ?.from === "us";

  return {
    intent: true,
    mode: "booking_link",
    channel: "heyreach",
    status: alreadyOffered
      ? "booking_link_already_in_thread"
      : bookingLink
        ? "booking_link_sent"
        : "booking_link_missing",
    bookingLink,
    alreadyOffered,
    appendLink: Boolean(bookingLink) && !alreadyOffered,
    waitingOnLead: alreadyOffered || lastFromUs,
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
