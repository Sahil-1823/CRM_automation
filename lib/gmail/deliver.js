import { getHeader } from "./prefilter.js";
import { sendRawMessage, modifyMessageLabels } from "./oauth.js";
import { ensureHandledLabel } from "./labels.js";
import { updateEvent } from "../store.js";

function appendOurMessage(conversation, text, at) {
  return [...(conversation || []), { from: "us", text, at, atSource: "gmail_send" }];
}

function encodeBase64Url(str) {
  return Buffer.from(str, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function buildMimeReply({
  to,
  from,
  subject,
  body,
  inReplyTo,
  references,
}) {
  const subj = subject?.startsWith("Re:") ? subject : `Re: ${subject || "(no subject)"}`;
  const lines = [
    `To: ${to}`,
    `From: ${from}`,
    `Subject: ${subj}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
  ];
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
  if (references) lines.push(`References: ${references}`);
  lines.push("", body);
  return lines.join("\r\n");
}

export async function deliverGmailReply(event, replyText) {
  const gmail = event.gmail || {};
  const accountEmail = gmail.accountEmail;
  const threadId = gmail.threadId;
  const messageId = gmail.messageId;

  if (!accountEmail || !threadId) {
    throw new Error("Missing Gmail thread context on event");
  }

  const to = event.lead?.fromEmail || gmail.fromEmail;
  if (!to) throw new Error("Missing recipient email");

  const subject = event.lead?.subject || gmail.subject || "";
  const inReplyTo = gmail.inReplyTo || messageId ? `<${messageId}>` : null;
  const references = gmail.references || inReplyTo;

  const raw = encodeBase64Url(
    buildMimeReply({
      to,
      from: accountEmail,
      subject,
      body: replyText,
      inReplyTo,
      references,
    }),
  );

  const sent = await sendRawMessage(accountEmail, { raw, threadId });
  const handledLabelId = await ensureHandledLabel(accountEmail);
  if (sent?.id) {
    await modifyMessageLabels(accountEmail, sent.id, { addLabelIds: [handledLabelId] });
  }

  const sentAt = new Date().toISOString();
  const conversation = appendOurMessage(event.lead?.conversation || [], replyText, sentAt, "gmail_send");

  const updated = await updateEvent(event.id, {
    status: "sent",
    sentAt,
    sendResult: { reply: replyText, sentAt, gmailMessageId: sent?.id || null },
    draft: { ...(event.draft || {}), reply: replyText },
    lead: { ...(event.lead || {}), conversation },
    gmail: {
      ...gmail,
      lastSentMessageId: sent?.id || null,
    },
  });

  return updated;
}

export function extractReplyHeaders(message) {
  const headers = message?.payload?.headers || [];
  const messageIdHeader = getHeader(headers, "Message-ID") || getHeader(headers, "Message-Id");
  const refs = getHeader(headers, "References");
  return {
    inReplyTo: messageIdHeader ? (messageIdHeader.startsWith("<") ? messageIdHeader : `<${messageIdHeader}>`) : null,
    references: refs || messageIdHeader || null,
  };
}
