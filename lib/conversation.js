/** Normalize a stored thread message for display and merging. */
export function normalizeThreadMessage(msg) {
  if (!msg || typeof msg !== "object") return null;
  const from = msg.from === "lead" || msg.from === "us" ? msg.from : "unknown";
  const text = typeof msg.text === "string" ? msg.text.trim() : "";
  if (!text) return null;
  return { from, text };
}

function rolePriority(from) {
  if (from === "us" || from === "lead") return 2;
  return 1;
}

function inferRole(text, { yourMessage = "", replyMessage = "", sentReply = "" } = {}) {
  const trimmed = text?.trim() || "";
  if (!trimmed) return null;
  if (replyMessage?.trim() === trimmed) return "lead";
  if (yourMessage?.trim() === trimmed) return "us";
  if (sentReply?.trim() === trimmed) return "us";
  return null;
}

/** Merge prior and incoming thread messages without duplicate text. */
export function mergeConversationHistory(previous, incoming) {
  return enrichDisplayThread({
    conversation: [...(previous || []), ...(incoming || [])],
  });
}

/**
 * Build a full two-sided thread for UI and AI context.
 * One bubble per unique message text; unknown roles are inferred when possible.
 */
export function enrichDisplayThread({
  conversation = [],
  yourMessage = "",
  replyMessage = "",
  sentReply = "",
} = {}) {
  const thread = [];
  const hints = { yourMessage, replyMessage, sentReply };

  const upsert = (from, text) => {
    const trimmed = typeof text === "string" ? text.trim() : "";
    if (!trimmed) return;

    const resolvedFrom =
      from === "unknown" ? inferRole(trimmed, hints) || "unknown" : from;
    const existingIdx = thread.findIndex((m) => m.text === trimmed);

    if (existingIdx >= 0) {
      const existing = thread[existingIdx];
      if (rolePriority(resolvedFrom) > rolePriority(existing.from)) {
        thread[existingIdx] = { from: resolvedFrom, text: trimmed };
      }
      return;
    }

    thread.push({ from: resolvedFrom, text: trimmed });
  };

  for (const msg of conversation) {
    const normalized = normalizeThreadMessage(msg);
    if (normalized) upsert(normalized.from, normalized.text);
  }

  const your = yourMessage?.trim() || "";
  const reply = replyMessage?.trim() || "";
  const sent = sentReply?.trim() || "";

  if (!thread.length) {
    if (your) upsert("us", your);
    if (reply) upsert("lead", reply);
    if (sent) upsert("us", sent);
    return thread;
  }

  if (your) {
    if (!thread.some((m) => m.text === your)) {
      const firstLead = thread.findIndex((m) => m.from === "lead");
      if (firstLead >= 0) thread.splice(firstLead, 0, { from: "us", text: your });
      else thread.push({ from: "us", text: your });
    } else {
      upsert("us", your);
    }
  }

  if (reply) upsert("lead", reply);

  if (sent) upsert("us", sent);

  return thread;
}

/** Build display thread from a stored dashboard event. */
export function conversationFromEvent(event) {
  const lead = event?.lead ?? {};
  const sentReply = event?.sendResult?.reply || "";

  return enrichDisplayThread({
    conversation: lead.conversation,
    yourMessage: lead.yourMessage,
    replyMessage: lead.replyMessage,
    sentReply,
  });
}
