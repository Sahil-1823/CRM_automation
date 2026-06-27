const SKIP_LABELS = new Set([
  "CATEGORY_PROMOTIONS",
  "CATEGORY_SOCIAL",
  "CATEGORY_UPDATES",
  "CATEGORY_FORUMS",
  "SPAM",
  "TRASH",
]);

const NO_REPLY_FROM = /(?:no-?reply|notifications?|alerts?|mailer-daemon|donotreply)@/i;
const OTP_SUBJECT = /\b(otp|one[- ]time|verification code|verify your|security code|2fa)\b/i;

export function getHeader(headers, name) {
  const h = (headers || []).find((x) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value || "";
}

export function shouldSkipGmailMessage({
  labelIds = [],
  headers = [],
  subject = "",
  accountEmail = "",
  threadMessages = [],
  handledLabelId = null,
}) {
  if (labelIds.some((id) => SKIP_LABELS.has(id))) {
    return { skip: true, reason: "category_or_spam" };
  }

  if (handledLabelId && labelIds.includes(handledLabelId)) {
    return { skip: true, reason: "already_handled" };
  }

  if (getHeader(headers, "List-Unsubscribe")) {
    return { skip: true, reason: "list_unsubscribe" };
  }

  const from = getHeader(headers, "From");
  if (NO_REPLY_FROM.test(from)) {
    return { skip: true, reason: "no_reply_sender" };
  }

  if (OTP_SUBJECT.test(subject || getHeader(headers, "Subject"))) {
    return { skip: true, reason: "otp_or_verification" };
  }

  const fromEmail = parseEmailAddress(from);
  if (fromEmail && accountEmail && fromEmail.toLowerCase() === accountEmail.toLowerCase()) {
    return { skip: true, reason: "self_sent" };
  }

  if (threadMessages.length) {
    const last = threadMessages[threadMessages.length - 1];
    if (last.from === "us") {
      return { skip: true, reason: "already_replied" };
    }
  }

  return { skip: false, reason: null };
}

export function parseEmailAddress(raw) {
  if (!raw) return null;
  const match = raw.match(/<([^>]+)>/);
  if (match) return match[1].trim();
  if (raw.includes("@")) return raw.trim();
  return null;
}

export function parseDisplayName(raw) {
  if (!raw) return null;
  const match = raw.match(/^([^<]+)</);
  if (match) return match[1].replace(/"/g, "").trim();
  return null;
}
