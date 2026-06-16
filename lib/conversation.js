/** Normalize a stored thread message for display and merging. */
export function normalizeThreadMessage(msg) {
  if (!msg || typeof msg !== "object") return null;
  const from = msg.from === "lead" || msg.from === "us" ? msg.from : "unknown";
  const text = typeof msg.text === "string" ? msg.text.trim() : "";
  if (!text) return null;
  return { from, text };
}

function threadKey(msg) {
  return `${msg.from}::${msg.text}`;
}

/** Merge prior and incoming thread messages without duplicates. */
export function mergeConversationHistory(previous, incoming) {
  const prior = Array.isArray(previous) ? previous.map(normalizeThreadMessage).filter(Boolean) : [];
  const next = Array.isArray(incoming) ? incoming.map(normalizeThreadMessage).filter(Boolean) : [];
  if (!prior.length) return next;
  if (!next.length) return prior;

  const merged = [...prior];
  const seen = new Set(prior.map(threadKey));
  for (const msg of next) {
    const key = threadKey(msg);
    if (!seen.has(key)) {
      merged.push(msg);
      seen.add(key);
    }
  }
  return merged;
}

/**
 * Build a full two-sided thread for UI and AI context.
 * Fills gaps when HeyReach only sends the latest inbound message.
 */
export function enrichDisplayThread({
  conversation = [],
  yourMessage = "",
  replyMessage = "",
  sentReply = "",
} = {}) {
  const thread = [];
  const seen = new Set();

  const add = (from, text) => {
    const trimmed = typeof text === "string" ? text.trim() : "";
    if (!trimmed) return;
    const normalized = { from, text: trimmed };
    const key = threadKey(normalized);
    if (seen.has(key)) return;
    seen.add(key);
    thread.push(normalized);
  };

  for (const msg of conversation) {
    const normalized = normalizeThreadMessage(msg);
    if (normalized) add(normalized.from, normalized.text);
  }

  const your = yourMessage?.trim() || "";
  const reply = replyMessage?.trim() || "";
  const sent = sentReply?.trim() || "";

  if (!thread.length) {
    if (your) add("us", your);
    if (reply) add("lead", reply);
    if (sent) add("us", sent);
    return thread;
  }

  const hasUs = thread.some((m) => m.from === "us");
  const hasLead = thread.some((m) => m.from === "lead");

  if (your && !thread.some((m) => m.from === "us" && m.text === your)) {
    if (!hasUs) {
      const firstLead = thread.findIndex((m) => m.from === "lead");
      if (firstLead >= 0) thread.splice(firstLead, 0, { from: "us", text: your });
      else thread.unshift({ from: "us", text: your });
      seen.add(`us::${your}`);
    }
  }

  if (reply && !thread.some((m) => m.from === "lead" && m.text === reply)) {
    if (!hasLead) thread.push({ from: "lead", text: reply });
    else add("lead", reply);
  }

  if (sent) add("us", sent);

  return thread;
}

/** Build display thread from a stored dashboard event. */
export function conversationFromEvent(event) {
  const lead = event?.lead ?? {};
  const sentReply =
    event?.status === "sent"
      ? event?.sendResult?.reply || event?.draft?.reply || ""
      : "";

  return enrichDisplayThread({
    conversation: lead.conversation,
    yourMessage: lead.yourMessage,
    replyMessage: lead.replyMessage,
    sentReply,
  });
}
