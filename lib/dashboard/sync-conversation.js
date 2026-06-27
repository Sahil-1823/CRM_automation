import { jsonResponse } from "../http.js";
import {
  getEvent,
  findEventByConversationId,
  findAllEventsByConversationId,
  updateEvent,
  serializeEvent,
} from "../store.js";
import { requireAuth } from "../auth.js";
import {
  conversationFromEvent,
  mergeWebhookConversation,
  syncAllLeadConversationEvents,
} from "../conversation/index.js";
import { fetchEnrichedIncomingThread } from "../conversation/sync.js";
import { log } from "../infra.js";

/** Pull latest HeyReach inbox thread into stored event(s) for the dashboard chat UI. */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return jsonResponse(res, 405, { error: "Method not allowed" });
  }

  try {
    if (!(await requireAuth(req, res))) return;

    const url = new URL(req.url, "http://localhost");
    const id = url.searchParams.get("id");
    if (!id) return jsonResponse(res, 400, { error: "Missing ?id=" });

    const event = await getEvent(id);
    if (!event) return jsonResponse(res, 404, { error: "Event not found" });

    const lead = event.lead || {};
    const conversationId = lead.conversationId || null;
    const linkedInAccountId =
      lead.linkedInAccountId ?? event.linkedInAccount?.linkedInAccountId ?? null;

    if (!conversationId || !linkedInAccountId) {
      return jsonResponse(res, 400, {
        error: "Missing conversationId or linkedInAccountId on this event",
      });
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

    const refreshed = await getEvent(id);
    log("info", "conversation.synced", {
      eventId: id,
      conversationId,
      messages: mergedConversation.length,
      eventsUpdated: sync.synced,
    });

    return jsonResponse(res, 200, {
      ok: true,
      event: serializeEvent(refreshed),
      messages: mergedConversation.length,
      eventsUpdated: sync.synced,
    });
  } catch (error) {
    console.error("sync-conversation error:", error);
    return jsonResponse(res, 500, { error: "Failed to sync conversation" });
  }
}
