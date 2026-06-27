import { getConfig } from "../config.js";

const LINKEDIN_KEYS = [
  "linkedInUrl",
  "linkedinUrl",
  "linkedin_url",
  "profileUrl",
  "profile_url",
  "linkedInProfileUrl",
  "linkedinProfileUrl",
];

const MESSAGE_KEYS = [
  "message",
  "replyMessage",
  "reply_message",
  "latestMessage",
  "latest_message",
  "leadMessage",
  "lead_message",
  "text",
  "body",
];

const YOUR_MESSAGE_KEYS = [
  "yourMessage",
  "your_message",
  "sentMessage",
  "sent_message",
  "previousMessage",
  "previous_message",
  "outboundMessage",
  "outbound_message",
];

const ACCOUNT_ID_KEYS = [
  "linkedInAccountId",
  "linkedinAccountId",
  "linkedin_account_id",
  "accountId",
  "account_id",
  "senderAccountId",
  "sender_account_id",
];

function pickString(source, keys) {
  if (!source || typeof source !== "object") {
    return "";
  }

  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function pickNestedString(payload, paths) {
  for (const path of paths) {
    let current = payload;
    for (const segment of path) {
      if (!current || typeof current !== "object") {
        current = null;
        break;
      }
      current = current[segment];
    }

    if (typeof current === "string" && current.trim()) {
      return current.trim();
    }
  }

  return "";
}

function pickNumber(source, keys) {
  if (!source || typeof source !== "object") {
    return null;
  }

  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) {
      return Number(value);
    }
  }

  return null;
}

function pickNestedNumber(payload, paths) {
  for (const path of paths) {
    let current = payload;
    for (const segment of path) {
      if (!current || typeof current !== "object") {
        current = null;
        break;
      }
      current = current[segment];
    }

    if (typeof current === "number" && Number.isFinite(current)) {
      return current;
    }
    if (typeof current === "string" && current.trim() && !Number.isNaN(Number(current))) {
      return Number(current);
    }
  }

  return null;
}

function splitName(fullName) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { firstName: "", lastName: "" };
  }
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: "" };
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

function normalizeLinkedInUrl(url) {
  if (!url) {
    return "";
  }

  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url.trim().replace(/\/$/, "");
  }
}

function messageText(msg) {
  if (!msg || typeof msg !== "object") return "";
  return (
    pickString(msg, ["text", "body", "message", "content"]) ||
    pickString(msg, MESSAGE_KEYS)
  );
}

/** Parse message timestamp from HeyReach thread objects into ISO string. */
export function messageTimestamp(msg) {
  if (!msg || typeof msg !== "object") return null;

  const keys = [
    "createdAt",
    "created_at",
    "sentAt",
    "sent_at",
    "timestamp",
    "time",
    "date",
    "messageTime",
    "message_time",
    "sentTime",
    "sent_time",
  ];

  for (const key of keys) {
    const value = msg[key];
    if (typeof value === "string" && value.trim()) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      const ms = value > 1e12 ? value : value * 1000;
      const parsed = new Date(ms);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    }
  }

  return null;
}

/** Extract a stable per-message id from a HeyReach message object, if available. */
export function messageId(msg) {
  if (!msg || typeof msg !== "object") return null;
  const keys = ["id", "messageId", "message_id", "_id", "uuid", "guid", "messageUrn", "urn"];
  for (const key of keys) {
    const value = msg[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function isFromLead(msg) {
  if (!msg || typeof msg !== "object") return null;
  if (typeof msg.isFromLead === "boolean") return msg.isFromLead;
  if (typeof msg.is_from_lead === "boolean") return msg.is_from_lead;
  if (typeof msg.isInbound === "boolean") return msg.isInbound;
  if (typeof msg.is_inbound === "boolean") return msg.is_inbound;
  if (typeof msg.inbound === "boolean") return msg.inbound;

  const dir = pickString(msg, ["direction", "senderType", "sender_type", "from", "messageDirection"]);
  if (dir) {
    const lower = dir.toLowerCase();
    if (["lead", "inbound", "incoming", "them", "prospect", "contact", "correspondent"].includes(lower)) {
      return true;
    }
    if (["us", "outbound", "outgoing", "me", "user", "account", "owner", "self"].includes(lower)) {
      return false;
    }
  }

  const sender = pickString(msg, ["sender", "senderRole", "author", "authorType", "messageSender"]);
  if (sender) {
    const lower = sender.toLowerCase();
    if (["lead", "prospect", "contact", "them", "correspondent", "recipient"].includes(lower)) {
      return true;
    }
    if (["me", "user", "account", "owner", "self", "sender", "us"].includes(lower)) {
      return false;
    }
  }

  return null;
}

function collectMessageArrays(payload) {
  const lead = payload.lead ?? payload.contact ?? payload.prospect ?? {};
  const candidates = [
    payload.recent_messages,
    payload.recentMessages,
    payload.messages,
    payload.conversationMessages,
    payload.conversation_messages,
    payload.thread,
    payload.chatHistory,
    payload.chat_history,
    lead.recent_messages,
    lead.recentMessages,
    lead.messages,
    lead.conversationMessages,
    lead.conversation_messages,
    lead.thread,
    lead.chatHistory,
    lead.chat_history,
    payload.conversation?.recent_messages,
    payload.conversation?.recentMessages,
    payload.conversation?.messages,
    payload.conversation?.conversationMessages,
    payload.conversation?.thread,
    lead.conversation?.recent_messages,
    lead.conversation?.recentMessages,
    lead.conversation?.messages,
    lead.conversation?.thread,
    payload.data?.recent_messages,
    payload.data?.messages,
  ];
  return candidates.find((arr) => Array.isArray(arr) && arr.length > 0) || null;
}

function lastMessageByRole(messages, role) {
  if (!messages?.length) return "";
  let found = "";
  for (const msg of messages) {
    const text = messageText(msg);
    if (!text) continue;
    const fromLead = isFromLead(msg);
    if (role === "lead" && fromLead === true) found = text;
    if (role === "us" && fromLead === false) found = text;
  }
  return found;
}

function lastMessageText(messages) {
  if (!messages?.length) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const text = messageText(messages[i]);
    if (text) return text;
  }
  return "";
}

function parseConversationThread(payload, { yourMessage, replyMessage }) {
  const raw = collectMessageArrays(payload);
  const thread = [];

  if (raw) {
    for (let i = 0; i < raw.length; i++) {
      const msg = raw[i];
      const text = messageText(msg);
      if (!text) continue;
      const fromLead = isFromLead(msg);
      let from =
        fromLead === true ? "lead" : fromLead === false ? "us" : "unknown";
      if (from === "unknown") {
        const trimmed = text.trim();
        const isLast = i === raw.length - 1;
        if (replyMessage?.trim() === trimmed) from = "lead";
        else if (yourMessage?.trim() === trimmed) from = "us";
        else if (!isLast) from = "us";
        else if (raw.length > 1) from = "lead";
      }
      const entry = { from, text };
      const id = messageId(msg);
      if (id) entry.id = id;
      const at = messageTimestamp(msg);
      if (at) {
        entry.at = at;
        entry.atSource = "heyreach_webhook";
      }
      thread.push(entry);
    }
  }

  if (!thread.length) {
    if (yourMessage) thread.push({ from: "us", text: yourMessage });
    if (replyMessage) thread.push({ from: "lead", text: replyMessage });
  }

  return thread;
}

/** Parse GetChatroom / inbox API response into a normalized thread. */
export function parseChatroomToThread(data, { yourMessage = "", replyMessage = "" } = {}) {
  if (!data || typeof data !== "object") return [];

  const candidates = [
    data.messages,
    data.recentMessages,
    data.recent_messages,
    data.chatroom?.messages,
    data.conversation?.messages,
    data.thread,
  ];
  const raw = candidates.find((arr) => Array.isArray(arr) && arr.length > 0);
  if (!raw) return [];

  const thread = [];
  for (let i = 0; i < raw.length; i++) {
    const msg = raw[i];
    const text = messageText(msg);
    if (!text) continue;

    let fromLead = isFromLead(msg);
    if (fromLead === null && typeof msg.isIncoming === "boolean") {
      fromLead = msg.isIncoming;
    }
    if (fromLead === null && typeof msg.incoming === "boolean") {
      fromLead = msg.incoming;
    }

    let from = fromLead === true ? "lead" : fromLead === false ? "us" : "unknown";
    if (from === "unknown") {
      const trimmed = text.trim();
      if (replyMessage?.trim() === trimmed) from = "lead";
      else if (yourMessage?.trim() === trimmed) from = "us";
      else if (i < raw.length - 1) from = "us";
      else from = "lead";
    }

    const entry = { from, text };
    const id = messageId(msg);
    if (id) entry.id = id;
    const at = messageTimestamp(msg);
    if (at) {
      entry.at = at;
      entry.atSource = "heyreach_api";
    }
    thread.push(entry);
  }

  return thread;
}

/**
 * Fetch full LinkedIn conversation history from HeyReach inbox API.
 * Webhooks often include only the latest reply — this fills in prior messages.
 */
export async function fetchHeyReachChatroom({ conversationId, linkedInAccountId, timeoutMs = 4000 }) {
  if (!conversationId || !linkedInAccountId) return [];

  const { heyreach } = getConfig();
  const accountId = encodeURIComponent(String(linkedInAccountId));
  const convId = encodeURIComponent(String(conversationId));
  const url = `${heyreach.apiBaseUrl}/inbox/GetChatroom/${accountId}/${convId}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        "X-API-KEY": heyreach.apiKey,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") {
      throw new Error(`HeyReach GetChatroom timed out after ${timeoutMs}ms`);
    }
    throw err;
  }
  clearTimeout(timer);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HeyReach GetChatroom failed (${res.status}): ${text}`);
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    return [];
  }

  return parseChatroomToThread(data);
}

/**
 * Prefer the most complete thread between webhook parse and inbox API.
 * Dedupe by message id when both sources provide one, fall back to text.
 */
export function mergeIncomingThreads(webhookThread = [], apiThread = []) {
  const webhook = (webhookThread || []).filter((m) => m?.text?.trim());
  const api = (apiThread || []).filter((m) => m?.text?.trim());

  if (!api.length) return webhook;
  if (!webhook.length) return api;
  if (api.length >= webhook.length) return api;

  const seenIds = new Set(api.map((m) => m.id).filter(Boolean));
  const seenText = new Set(api.map((m) => m.text.trim()));
  const extra = webhook.filter((m) => {
    if (m.id && seenIds.has(m.id)) return false;
    return !seenText.has(m.text.trim());
  });
  return [...api, ...extra];
}

function nameFromLinkedInUrl(url) {
  if (!url) return "";
  const match = String(url).match(/linkedin\.com\/in\/([^/?#]+)/i);
  if (!match) return "";
  return decodeURIComponent(match[1])
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalizeWebhookSecret(value) {
  if (!value || typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.toLowerCase().startsWith("bearer ") ? trimmed.slice(7).trim() : trimmed;
}

export function verifyHeyReachSecret(req, secret) {
  const expected = normalizeWebhookSecret(secret);
  if (!expected) {
    return true;
  }

  const candidates = [];
  const authHeader = req.headers.authorization ?? "";
  if (authHeader) candidates.push(authHeader);

  for (const key of [
    "x-webhook-secret",
    "x-heyreach-secret",
    "x-heyreach-webhook-secret",
    "heyreach_webhook_secret",
  ]) {
    if (req.headers[key]) candidates.push(req.headers[key]);
  }

  return candidates.some((value) => normalizeWebhookSecret(value) === expected);
}

export function parseHeyReachPayload(payload) {
  const lead = payload.lead ?? payload.contact ?? payload.prospect ?? payload;
  const correspondent =
    payload.correspondent ??
    payload.correspondentProfile ??
    payload.correspondent_profile ??
    {};
  const correspondentName =
    pickString(correspondent, ["fullName", "full_name", "name", "displayName"]) ||
    [
      pickString(correspondent, ["firstName", "first_name"]),
      pickString(correspondent, ["lastName", "last_name"]),
    ]
      .filter(Boolean)
      .join(" ");

  const firstName =
    pickString(lead, ["firstName", "first_name", "givenName", "given_name"]) ||
    pickNestedString(payload, [["lead", "firstName"], ["contact", "firstName"]]) ||
    pickString(correspondent, ["firstName", "first_name"]);
  const lastName =
    pickString(lead, ["lastName", "last_name", "familyName", "family_name"]) ||
    pickNestedString(payload, [["lead", "lastName"], ["contact", "lastName"]]) ||
    pickString(correspondent, ["lastName", "last_name"]);
  const fullName =
    pickString(lead, ["fullName", "full_name", "name"]) ||
    pickString(payload, ["leadName", "lead_name", "name", "correspondentName", "prospectName"]) ||
    correspondentName ||
    [firstName, lastName].filter(Boolean).join(" ");

  const nameParts = firstName || lastName ? { firstName, lastName } : splitName(fullName);
  const linkedInUrl = normalizeLinkedInUrl(
    pickString(lead, LINKEDIN_KEYS) ||
      pickString(payload, LINKEDIN_KEYS) ||
      pickNestedString(payload, [
        ["lead", "profileUrl"],
        ["lead", "linkedInUrl"],
        ["contact", "profileUrl"],
      ]),
  );

  const messageArray = collectMessageArrays(payload);

  let replyMessage =
    pickString(payload, MESSAGE_KEYS) ||
    pickString(lead, MESSAGE_KEYS) ||
    pickNestedString(payload, [
      ["message", "text"],
      ["reply", "message"],
      ["reply", "text"],
    ]);

  let yourMessage =
    pickString(payload, YOUR_MESSAGE_KEYS) ||
    pickNestedString(payload, [
      ["yourMessage", "text"],
      ["outbound", "message"],
      ["campaignMessage", "text"],
    ]);

  if (!replyMessage && messageArray) {
    replyMessage =
      lastMessageByRole(messageArray, "lead") || lastMessageText(messageArray);
  }
  if (!yourMessage && messageArray) {
    yourMessage = lastMessageByRole(messageArray, "us");
  }

  const companyName =
    pickString(lead, ["companyName", "company_name", "company"]) ||
    pickString(payload, ["companyName", "company_name", "company"]) ||
    pickNestedString(payload, [["lead", "companyName"], ["company", "name"]]);

  const jobTitle =
    pickString(lead, ["jobTitle", "job_title", "position", "title"]) ||
    pickString(payload, ["jobTitle", "job_title", "position", "title"]);

  const campaignName =
    pickString(payload, ["campaignName", "campaign_name"]) ||
    pickString(payload.campaign ?? {}, ["name", "campaignName", "title"]) ||
    pickNestedString(payload, [["campaign", "name"], ["campaign", "campaignName"]]) ||
    "";

  const campaignId =
    pickNumber(payload, ["campaignId", "campaign_id"]) ||
    pickNumber(payload.campaign ?? {}, ["id", "campaignId", "campaign_id"]) ||
    pickNestedNumber(payload, [["campaign", "id"]]);

  const conversationId =
    pickString(payload, ["conversationId", "conversation_id"]) ||
    pickString(payload.conversation ?? {}, ["id", "conversationId", "conversation_id"]) ||
    "";

  const linkedInAccountId =
    pickNumber(payload, ACCOUNT_ID_KEYS) ||
    pickNumber(lead, ACCOUNT_ID_KEYS) ||
    pickNestedNumber(payload, [
      ["sender", "id"],
      ["linkedInAccount", "id"],
      ["linkedinAccount", "id"],
      ["senderAccount", "id"],
      ["account", "id"],
      ["conversation", "linkedInAccountId"],
      ["conversation", "accountId"],
    ]);

  const linkedInAccountObj =
    payload.linkedInAccount ??
    payload.linkedinAccount ??
    payload.senderAccount ??
    payload.sender ??
    {};

  const linkedInAccountName =
    pickString(linkedInAccountObj, [
      "name",
      "fullName",
      "accountName",
      "displayName",
      "linkedInAccountName",
    ]) ||
    pickNestedString(payload, [
      ["linkedInAccount", "name"],
      ["linkedInAccount", "fullName"],
      ["linkedinAccount", "name"],
      ["senderAccount", "name"],
      ["sender", "name"],
      ["sender", "fullName"],
    ]) ||
    [
      pickString(linkedInAccountObj, ["firstName", "first_name"]),
      pickString(linkedInAccountObj, ["lastName", "last_name"]),
    ]
      .filter(Boolean)
      .join(" ")
      .trim();

  const workspaceObj = payload.workspace ?? payload.heyreachWorkspace ?? {};

  const workspaceId =
    pickString(payload, ["workspaceId", "workspace_id"]) ||
    pickString(workspaceObj, ["id", "workspaceId", "workspace_id"]) ||
    (pickNumber(payload, ["workspaceId", "workspace_id"]) != null
      ? String(pickNumber(payload, ["workspaceId", "workspace_id"]))
      : "") ||
    (pickNumber(workspaceObj, ["id", "workspaceId"]) != null
      ? String(pickNumber(workspaceObj, ["id", "workspaceId"]))
      : "");

  const workspaceName =
    pickString(payload, ["workspaceName", "workspace_name"]) ||
    pickString(workspaceObj, ["name", "workspaceName", "workspace_name"]) ||
    pickNestedString(payload, [["workspace", "name"], ["organization", "workspaceName"]]);

  const eventType =
    pickString(payload, ["eventType", "event_type", "type", "event"]) || "";

  const messageType =
    pickString(payload, ["messageType", "message_type"]) ||
    pickNestedString(payload, [["message", "type"], ["message", "messageType"]]) ||
    eventType;

  const leadName =
    [nameParts.firstName, nameParts.lastName].filter(Boolean).join(" ") ||
    fullName ||
    nameFromLinkedInUrl(linkedInUrl) ||
    (conversationId ? `Lead ${String(conversationId).slice(0, 8)}` : "LinkedIn lead");
  const conversation = parseConversationThread(payload, { yourMessage, replyMessage });

  const errors = [];
  if (!replyMessage) {
    errors.push("reply message");
  }

  return {
    valid: errors.length === 0,
    errors,
    lead: {
      firstName: nameParts.firstName,
      lastName: nameParts.lastName,
      fullName: leadName,
      linkedInUrl,
      companyName,
      jobTitle,
      replyMessage,
      yourMessage,
      conversation,
      campaignId,
      campaignName,
      conversationId,
      linkedInAccountId,
      linkedInAccountName,
      workspaceId: workspaceId || null,
      workspaceName: workspaceName || null,
      eventType,
      messageType,
    },
  };
}

const MESSAGE_TYPE_LABELS = {
  every_message_reply_received: "Reply received",
  message_reply_received: "First reply",
  inmail_reply_received: "InMail reply",
  inmail_sent: "InMail sent",
  message_sent: "Message sent",
  connection_request_sent: "Connection sent",
  connection_request_accepted: "Connection accepted",
  lead_tag_updated: "Tag updated",
  campaign_completed: "Campaign completed",
};

/** Human-readable label for HeyReach webhook event / message type. */
export function formatHeyReachMessageType(raw) {
  if (!raw || typeof raw !== "string") return "";
  const key = raw.trim().toLowerCase();
  if (MESSAGE_TYPE_LABELS[key]) return MESSAGE_TYPE_LABELS[key];
  return key
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Send a LinkedIn reply through HeyReach inbox API.
 * @see https://github.com/bcharleson/heyreach-cli — POST /inbox/SendMessage
 */
export async function sendHeyReachMessage({ conversationId, linkedInAccountId, message }) {
  const { heyreach } = getConfig();

  if (!conversationId) {
    throw new Error("Missing conversationId — required to send via HeyReach");
  }
  if (!linkedInAccountId) {
    throw new Error("Missing linkedInAccountId — required to send via HeyReach");
  }
  if (!message?.trim()) {
    throw new Error("Reply message is empty");
  }

  const body = {
    conversationId,
    linkedInAccountId: Number(linkedInAccountId),
    message: message.trim(),
  };

  const res = await fetch(`${heyreach.apiBaseUrl}/inbox/SendMessage`, {
    method: "POST",
    headers: {
      "X-API-KEY": heyreach.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HeyReach send failed (${res.status}): ${text}`);
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty or non-json body is ok */
  }

  return { sent: true, via: "heyreach", response: data };
}
