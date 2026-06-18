import { jsonResponse, readJsonBody } from "../lib/http.js";
import {
  getEvent,
  updateEvent,
  findAllEventsByConversationId,
} from "../lib/store.js";
import { sendHeyReachMessage } from "../lib/heyreach.js";
import { requireAuth } from "../lib/auth.js";
import {
  enrichDisplayThread,
  appendOurMessage,
  syncAllLeadConversationEvents,
} from "../lib/conversation.js";
import { invalidateChatroomCache } from "../lib/conversation-sync.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return jsonResponse(res, 405, { error: "Method not allowed" });
  }

  try {
    if (!(await requireAuth(req, res))) return;
    const url = new URL(req.url, "http://localhost");
    const id = url.searchParams.get("id");
    if (!id) return jsonResponse(res, 400, { error: "Missing ?id=" });

    const body = await readJsonBody(req);
    const event = await getEvent(id);
    if (!event) return jsonResponse(res, 404, { error: "Event not found" });
    if (event.status === "sent") {
      return jsonResponse(res, 409, { error: "Event already sent" });
    }

    const replyText = (body.reply ?? event.draft?.reply ?? "").trim();
    if (!replyText) {
      return jsonResponse(res, 400, { error: "Reply text is empty" });
    }

    const lead = event.lead ?? {};
    const conversationId = lead.conversationId || null;
    const linkedInAccountId =
      lead.linkedInAccountId ?? event.linkedInAccount?.linkedInAccountId ?? null;

    if (!linkedInAccountId) {
      return jsonResponse(res, 400, {
        error: "Missing LinkedIn account on this conversation — webhook must include linkedInAccountId",
      });
    }

    const heyReachResult = await sendHeyReachMessage({
      conversationId: lead.conversationId,
      linkedInAccountId,
      message: replyText,
    });

    const sentAt = new Date().toISOString();
    const baseThread = enrichDisplayThread({
      conversation: lead.conversation,
      yourMessage: lead.yourMessage,
      replyMessage: lead.replyMessage,
      sentReply: replyText,
      sentReplyAt: sentAt,
    });
    const conversation = appendOurMessage(baseThread, replyText, sentAt, "dashboard_send");

    const updated = await updateEvent(id, {
      status: "sent",
      sentAt,
      sendResult: { reply: replyText, sentAt, heyreach: heyReachResult, linkedInAccountId },
      draft: { ...(event.draft || {}), reply: replyText },
      lead: { ...lead, conversation },
    });

    if (conversationId) {
      await invalidateChatroomCache(conversationId, linkedInAccountId);
      await syncAllLeadConversationEvents({
        conversationId,
        mergedConversation: conversation,
        parsedLead: lead,
        findAllEvents: findAllEventsByConversationId,
        updateEvent,
      });
    }

    const refreshed = await getEvent(id);
    return jsonResponse(res, 200, { ok: true, event: refreshed || updated });
  } catch (error) {
    console.error("send-reply error:", error);
    return jsonResponse(res, 500, {
      error: "Failed to send via HeyReach",
      message: error.message,
    });
  }
}
