/** Normalize a stored thread message for display and merging. */
export function normalizeThreadMessage(msg) {
  if (!msg || typeof msg !== "object") return null;
  const from = msg.from === "lead" || msg.from === "us" ? msg.from : "unknown";
  const text = typeof msg.text === "string" ? msg.text.trim() : "";
  if (!text) return null;
  const at = typeof msg.at === "string" && msg.at.trim() ? msg.at.trim() : null;
  return at ? { from, text, at } : { from, text };
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
  sentReplyAt = "",
  replyMessageAt = "",
  yourMessageAt = "",
} = {}) {
  const thread = [];
  const hints = { yourMessage, replyMessage, sentReply };

  const upsert = (from, text, at = null) => {
    const trimmed = typeof text === "string" ? text.trim() : "";
    if (!trimmed) return;

    const resolvedFrom =
      from === "unknown" ? inferRole(trimmed, hints) || "unknown" : from;
    const existingIdx = thread.findIndex((m) => m.text === trimmed);

    if (existingIdx >= 0) {
      const existing = thread[existingIdx];
      if (rolePriority(resolvedFrom) > rolePriority(existing.from)) {
        thread[existingIdx] = {
          from: resolvedFrom,
          text: trimmed,
          ...(existing.at ? { at: existing.at } : {}),
        };
      }
      if (at && !thread[existingIdx].at) thread[existingIdx].at = at;
      return;
    }

    const entry = { from: resolvedFrom, text: trimmed };
    if (at) entry.at = at;
    thread.push(entry);
  };

  for (const msg of conversation) {
    const normalized = normalizeThreadMessage(msg);
    if (normalized) upsert(normalized.from, normalized.text, normalized.at || null);
  }

  const your = yourMessage?.trim() || "";
  const reply = replyMessage?.trim() || "";
  const sent = sentReply?.trim() || "";

  if (!thread.length) {
    if (your) upsert("us", your, yourMessageAt || null);
    if (reply) upsert("lead", reply, replyMessageAt || null);
    if (sent) upsert("us", sent, sentReplyAt || null);
    return thread;
  }

  if (your) {
    if (!thread.some((m) => m.text === your)) {
      const firstLead = thread.findIndex((m) => m.from === "lead");
      const entry = { from: "us", text: your };
      if (yourMessageAt) entry.at = yourMessageAt;
      if (firstLead >= 0) thread.splice(firstLead, 0, entry);
      else thread.push(entry);
    } else {
      upsert("us", your, yourMessageAt || null);
    }
  }

  if (reply) upsert("lead", reply, replyMessageAt || null);

  if (sent) upsert("us", sent, sentReplyAt || null);

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
    sentReplyAt: event?.sentAt || event?.sendResult?.sentAt || "",
  });
}

export function lastThreadMessage(thread) {
  return thread?.length ? thread[thread.length - 1] : null;
}

export function latestLeadMessage(thread) {
  for (let i = thread.length - 1; i >= 0; i--) {
    if (thread[i].from === "lead") return thread[i].text;
  }
  return "";
}

/** True when the newest message in the thread is an inbound lead reply. */
export function isAwaitingLeadReply(thread) {
  return lastThreadMessage(thread)?.from === "lead";
}

export function wasReplyAlreadyHandled(event, replyText) {
  if (!event || !replyText) return false;
  const trimmed = replyText.trim();
  const handled = event.lead?.replyMessage?.trim();
  if (handled !== trimmed) return false;
  return event.status === "sent" || event.status === "dismissed";
}

/**
 * Merge webhook thread with prior event history without resurrecting old lead replies
 * after we already sent a response.
 */
export function mergeWebhookConversation({
  priorEvent,
  priorThread,
  incomingThread,
  yourMessage = "",
  replyMessage = "",
}) {
  const sentReply =
    priorEvent?.status === "sent" ? priorEvent.sendResult?.reply || "" : "";
  const sentReplyAt =
    priorEvent?.status === "sent" ? priorEvent.sentAt || priorEvent.sendResult?.sentAt || "" : "";

  const normalizedIncoming = (incomingThread || [])
    .map(normalizeThreadMessage)
    .filter(Boolean);

  if (!priorThread?.length) {
    return enrichDisplayThread({
      conversation: normalizedIncoming,
      yourMessage,
      replyMessage,
      sentReply,
      sentReplyAt,
    });
  }

  if (!normalizedIncoming.length) {
    return enrichDisplayThread({
      conversation: priorThread,
      yourMessage,
      replyMessage,
      sentReply,
      sentReplyAt,
    });
  }

  const base = enrichDisplayThread({
    conversation: priorThread,
    yourMessage,
    replyMessage: "",
    sentReply,
    sentReplyAt,
  });

  const seen = new Set(base.map((m) => m.text));
  const appended = [];
  for (const msg of normalizedIncoming) {
    if (!msg.text || seen.has(msg.text)) continue;
    seen.add(msg.text);
    appended.push(msg);
  }

  const latestAppendedLead = [...appended].reverse().find((m) => m.from === "lead");
  const latestIncomingLead = [...normalizedIncoming].reverse().find((m) => m.from === "lead");

  return enrichDisplayThread({
    conversation: [...base, ...appended],
    yourMessage: "",
    replyMessage:
      replyMessage || latestAppendedLead?.text || latestIncomingLead?.text || "",
    sentReply,
    sentReplyAt,
    replyMessageAt: latestAppendedLead?.at || latestIncomingLead?.at || "",
  });
}

/**
 * Decide whether a webhook should open/update a review item.
 * Only process when the latest message is a new lead reply we have not handled.
 */
export function evaluateInboundWebhook({
  priorEvent,
  priorThread,
  mergedConversation,
  incomingReplyMessage,
}) {
  const latestLeadReply = latestLeadMessage(mergedConversation);
  const incoming = (incomingReplyMessage || "").trim();

  if (!isAwaitingLeadReply(mergedConversation)) {
    return {
      process: false,
      reason: "already_replied",
      latestLeadReply: latestLeadReply || incoming,
    };
  }

  const replyToHandle = latestLeadReply || incoming;
  if (!replyToHandle) {
    return { process: false, reason: "no_reply", latestLeadReply: "" };
  }

  if (wasReplyAlreadyHandled(priorEvent, replyToHandle)) {
    return { process: false, reason: "already_handled", latestLeadReply: replyToHandle };
  }

  if (priorEvent?.status === "sent" && priorEvent.sendResult?.reply) {
    const sentText = priorEvent.sendResult.reply.trim();
    const sentIdx = priorThread.findIndex((m) => m.from === "us" && m.text === sentText);
    const leadIdx = priorThread.findIndex((m) => m.from === "lead" && m.text === replyToHandle);
    if (sentIdx >= 0 && leadIdx >= 0 && leadIdx < sentIdx) {
      return { process: false, reason: "stale_before_sent", latestLeadReply: replyToHandle };
    }

    const lastPrior = lastThreadMessage(priorThread);
    if (lastPrior?.from === "us" && priorThread.some((m) => m.text === replyToHandle)) {
      return { process: false, reason: "stale_resend", latestLeadReply: replyToHandle };
    }
  }

  return { process: true, reason: "new_reply", latestLeadReply: replyToHandle };
}

/** Latest outbound message in a thread (our side). */
export function latestOurMessage(thread) {
  for (let i = thread.length - 1; i >= 0; i--) {
    if (thread[i].from === "us") return thread[i];
  }
  return null;
}

/**
 * Update only the stored thread — keeps each event's own reply/sentiment intact.
 */
export function buildConversationOnlyPatch(event, mergedConversation) {
  if (!event || !mergedConversation?.length) return null;
  return {
    lead: {
      ...event.lead,
      conversation: mergedConversation,
    },
    conversationSyncedAt: new Date().toISOString(),
  };
}

/**
 * When skipping review, still persist merged thread so chat shows our HeyReach replies.
 * Does not reopen pending review or regenerate drafts.
 */
export function buildConversationSyncPatch(priorEvent, mergedConversation, parsedLead = {}) {
  if (!priorEvent || !mergedConversation?.length) return null;

  const latestLead = latestLeadMessage(mergedConversation);
  const latestOurs = latestOurMessage(mergedConversation);

  const lead = {
    ...priorEvent.lead,
    conversation: mergedConversation,
    yourMessage: parsedLead.yourMessage || priorEvent.lead?.yourMessage || "",
    fullName: parsedLead.fullName || priorEvent.lead?.fullName,
    companyName: parsedLead.companyName ?? priorEvent.lead?.companyName,
    conversationId: parsedLead.conversationId || priorEvent.lead?.conversationId,
    linkedInAccountId: parsedLead.linkedInAccountId ?? priorEvent.lead?.linkedInAccountId,
  };

  // Pending items track the active lead reply; closed items keep their original context.
  if (priorEvent.status === "pending_review") {
    lead.replyMessage = latestLead || priorEvent.lead?.replyMessage || "";
  } else {
    lead.replyMessage = priorEvent.lead?.replyMessage || latestLead || "";
  }

  const patch = {
    lead,
    conversationSyncedAt: new Date().toISOString(),
  };

  if (latestOurs?.text) {
    const sentText = priorEvent.sendResult?.reply?.trim();
    if (priorEvent.status === "sent" && (!sentText || sentText === latestOurs.text)) {
      patch.sendResult = {
        ...(priorEvent.sendResult || {}),
        reply: latestOurs.text,
        sentAt: latestOurs.at || priorEvent.sentAt || priorEvent.sendResult?.sentAt || null,
      };
    }
  }

  return patch;
}

/**
 * Sync full conversation thread to every dashboard event for this HeyReach conversation.
 * Primary (newest) event also gets metadata refresh; older events keep their status/reply context.
 */
export async function syncAllLeadConversationEvents({
  conversationId,
  mergedConversation,
  parsedLead,
  findAllEvents,
  updateEvent,
}) {
  if (!conversationId || !mergedConversation?.length || !findAllEvents || !updateEvent) {
    return { synced: 0, primaryId: null };
  }

  const related = await findAllEvents(conversationId);
  if (!related.length) return { synced: 0, primaryId: null };

  const syncedAt = new Date().toISOString();
  let synced = 0;

  for (let i = 0; i < related.length; i++) {
    const event = related[i];
    const patch =
      i === 0 && event.status === "pending_review"
        ? { ...buildConversationSyncPatch(event, mergedConversation, parsedLead), conversationSyncedAt: syncedAt }
        : buildConversationOnlyPatch(event, mergedConversation);

    if (patch) {
      await updateEvent(event.id, patch);
      synced++;
    }
  }

  return { synced, primaryId: related[0].id };
}
