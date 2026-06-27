import {
  getHeader,
  parseEmailAddress,
  parseDisplayName,
} from "./prefilter.js";

function decodeBase64Url(data) {
  if (!data) return "";
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function extractBodyFromPart(part) {
  if (!part) return "";
  const mime = part.mimeType || "";
  if ((mime === "text/plain" || mime === "text/html") && part.body?.data) {
    let text = decodeBase64Url(part.body.data);
    if (mime === "text/html") {
      text = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    }
    return text;
  }
  if (part.parts?.length) {
    const plain = part.parts.find((p) => p.mimeType === "text/plain");
    if (plain) return extractBodyFromPart(plain);
    return part.parts.map(extractBodyFromPart).filter(Boolean).join("\n");
  }
  return "";
}

export function extractMessageBody(message) {
  if (!message?.payload) return "";
  return extractBodyFromPart(message.payload).trim();
}

export function messageHeaders(message) {
  return message?.payload?.headers || [];
}

export function buildConversationFromThread(thread, accountEmail) {
  const messages = thread?.messages || [];
  const account = (accountEmail || "").toLowerCase();

  return messages
    .map((msg) => {
      const headers = messageHeaders(msg);
      const from = getHeader(headers, "From");
      const fromEmail = parseEmailAddress(from)?.toLowerCase() || "";
      const text = extractMessageBody(msg) || msg.snippet || "";
      const date = getHeader(headers, "Date");
      return {
        from: fromEmail === account ? "us" : "lead",
        text,
        at: date || null,
        messageId: msg.id,
      };
    })
    .filter((m) => m.text);
}

export function shapeLeadFromGmail({
  message,
  thread,
  accountEmail,
}) {
  const headers = messageHeaders(message);
  const fromRaw = getHeader(headers, "From");
  const fromEmail = parseEmailAddress(fromRaw);
  const fromName = parseDisplayName(fromRaw) || fromEmail?.split("@")[0] || "Unknown";
  const subject = getHeader(headers, "Subject");
  const body = extractMessageBody(message) || message.snippet || "";
  const conversation = buildConversationFromThread(thread, accountEmail);

  return {
    fullName: fromName,
    companyName: fromEmail?.split("@")[1] || null,
    jobTitle: null,
    subject,
    replyMessage: body,
    yourMessage: null,
    conversation,
    fromEmail,
    messageId: message.id,
    threadId: message.threadId,
    labelIds: message.labelIds || [],
    headers,
  };
}
