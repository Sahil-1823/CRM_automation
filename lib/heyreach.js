import { getConfig } from "./config.js";

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

function isFromLead(msg) {
  if (!msg || typeof msg !== "object") return null;
  if (typeof msg.isFromLead === "boolean") return msg.isFromLead;
  if (typeof msg.is_from_lead === "boolean") return msg.is_from_lead;
  const dir = pickString(msg, ["direction", "senderType", "sender_type", "from"]);
  if (!dir) return null;
  const lower = dir.toLowerCase();
  if (["lead", "inbound", "incoming", "them", "prospect", "contact"].includes(lower)) {
    return true;
  }
  if (["us", "outbound", "outgoing", "sender", "me", "user"].includes(lower)) {
    return false;
  }
  return null;
}

function collectMessageArrays(payload) {
  const candidates = [
    payload.messages,
    payload.conversationMessages,
    payload.conversation_messages,
    payload.thread,
    payload.chatHistory,
    payload.chat_history,
    payload.conversation?.messages,
    payload.conversation?.conversationMessages,
    payload.conversation?.thread,
  ];
  return candidates.find((arr) => Array.isArray(arr) && arr.length > 0) || null;
}

function parseConversationThread(payload, { yourMessage, replyMessage }) {
  const raw = collectMessageArrays(payload);
  const thread = [];

  if (raw) {
    for (const msg of raw) {
      const text = messageText(msg);
      if (!text) continue;
      const fromLead = isFromLead(msg);
      thread.push({
        from: fromLead === true ? "lead" : fromLead === false ? "us" : "unknown",
        text,
      });
    }
  }

  if (!thread.length) {
    if (yourMessage) thread.push({ from: "us", text: yourMessage });
    if (replyMessage) thread.push({ from: "lead", text: replyMessage });
  }

  return thread;
}

export function verifyHeyReachSecret(req, secret) {
  if (!secret) {
    return true;
  }

  const authHeader = req.headers.authorization ?? "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const headerSecret =
    req.headers["x-webhook-secret"] ??
    req.headers["x-heyreach-secret"] ??
    req.headers["x-heyreach-webhook-secret"] ??
    "";

  return bearer === secret || headerSecret === secret;
}

export function parseHeyReachPayload(payload) {
  const lead = payload.lead ?? payload.contact ?? payload.prospect ?? payload;
  const firstName =
    pickString(lead, ["firstName", "first_name", "givenName", "given_name"]) ||
    pickNestedString(payload, [["lead", "firstName"], ["contact", "firstName"]]);
  const lastName =
    pickString(lead, ["lastName", "last_name", "familyName", "family_name"]) ||
    pickNestedString(payload, [["lead", "lastName"], ["contact", "lastName"]]);
  const fullName =
    pickString(lead, ["fullName", "full_name", "name"]) ||
    pickString(payload, ["leadName", "lead_name", "name"]) ||
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

  const replyMessage =
    pickString(payload, MESSAGE_KEYS) ||
    pickString(lead, MESSAGE_KEYS) ||
    pickNestedString(payload, [
      ["message", "text"],
      ["reply", "message"],
      ["reply", "text"],
    ]);

  const yourMessage =
    pickString(payload, YOUR_MESSAGE_KEYS) ||
    pickNestedString(payload, [
      ["yourMessage", "text"],
      ["outbound", "message"],
      ["campaignMessage", "text"],
    ]);

  const companyName =
    pickString(lead, ["companyName", "company_name", "company"]) ||
    pickString(payload, ["companyName", "company_name", "company"]) ||
    pickNestedString(payload, [["lead", "companyName"], ["company", "name"]]);

  const jobTitle =
    pickString(lead, ["jobTitle", "job_title", "position", "title"]) ||
    pickString(payload, ["jobTitle", "job_title", "position", "title"]);

  const campaignName =
    pickString(payload, ["campaignName", "campaign_name"]) ||
    pickString(payload.campaign ?? {}, ["name", "campaignName"]) ||
    "";

  const conversationId =
    pickString(payload, ["conversationId", "conversation_id"]) ||
    pickString(payload.conversation ?? {}, ["id", "conversationId", "conversation_id"]) ||
    "";

  const linkedInAccountId =
    pickNumber(payload, ACCOUNT_ID_KEYS) ||
    pickNumber(lead, ACCOUNT_ID_KEYS) ||
    pickNestedNumber(payload, [
      ["linkedInAccount", "id"],
      ["linkedinAccount", "id"],
      ["senderAccount", "id"],
      ["account", "id"],
      ["conversation", "linkedInAccountId"],
      ["conversation", "accountId"],
    ]);

  const eventType =
    pickString(payload, ["eventType", "event_type", "type", "event"]) || "";

  const leadName = [nameParts.firstName, nameParts.lastName].filter(Boolean).join(" ") || fullName;
  const conversation = parseConversationThread(payload, { yourMessage, replyMessage });

  const errors = [];
  if (!leadName) {
    errors.push("lead name");
  }
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
      campaignName,
      conversationId,
      linkedInAccountId,
      eventType,
    },
  };
}

/**
 * Send a LinkedIn reply through HeyReach inbox API.
 * @see https://github.com/bcharleson/heyreach-cli — POST /inbox/SendMessage
 */
export async function sendHeyReachMessage({ conversationId, linkedInAccountId, message, subject }) {
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
  if (subject?.trim()) {
    body.subject = subject.trim();
  }

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
