import {
  getEvent,
  findEventByConversationId,
  findAllEventsByConversationId,
  updateEvent,
} from "../store.js";
import {
  conversationFromEvent,
  mergeWebhookConversation,
  syncAllLeadConversationEvents,
  latestLeadMessage,
} from "../conversation/index.js";
import { fetchEnrichedIncomingThread } from "../conversation/sync.js";
import { log } from "../infra.js";

/**
 * Pull latest HeyReach inbox thread into stored event(s).
 * @returns {{ event, messages, eventsUpdated } | null} null if event cannot sync (gmail / missing ids)
 */
export async function syncHeyReachConversationByEventId(id) {
  const event = await getEvent(id);
  if (!event) throw new Error("Event not found");

  if (event.channel === "gmail") {
    return { event, messages: (event.lead?.conversation || []).length, eventsUpdated: 0, synced: false };
  }

  const lead = event.lead || {};
  const conversationId = lead.conversationId || null;
  const linkedInAccountId =
    lead.linkedInAccountId ?? event.linkedInAccount?.linkedInAccountId ?? null;

  if (!conversationId || !linkedInAccountId) {
    return { event, messages: (lead.conversation || []).length, eventsUpdated: 0, synced: false };
  }

  const latestInConversation = await findEventByConversationId(conversationId);
  const priorEvent = latestInConversation || event;
  const priorThread = conversationFromEvent(priorEvent);

  const incomingThread = await fetchEnrichedIncomingThread({
    conversationId,
    linkedInAccountId,
    webhookThread: [],
    forceRefresh: true,
  });

  const mergedConversation = mergeWebhookConversation({
    priorEvent,
    priorThread,
    incomingThread,
    yourMessage: lead.yourMessage || "",
    replyMessage: lead.replyMessage || "",
  });

  const sync = await syncAllLeadConversationEvents({
    conversationId,
    mergedConversation,
    parsedLead: lead,
    findAllEvents: findAllEventsByConversationId,
    updateEvent,
  });

  // Ensure the requested event itself has the latest thread + lead reply text
  // (syncAll may prefer the primary pending event).
  const latestLead = latestLeadMessage(mergedConversation) || lead.replyMessage || "";
  await updateEvent(id, {
    lead: {
      ...lead,
      conversation: mergedConversation,
      replyMessage: latestLead || lead.replyMessage || "",
    },
    conversationSyncedAt: new Date().toISOString(),
  });

  const refreshed = await getEvent(id);
  log("info", "conversation.synced", {
    eventId: id,
    conversationId,
    messages: mergedConversation.length,
    eventsUpdated: sync.synced,
  });

  return {
    event: refreshed,
    messages: mergedConversation.length,
    eventsUpdated: sync.synced,
    synced: true,
  };
}
