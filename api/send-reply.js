import { jsonResponse, readJsonBody } from "../lib/http.js";
import {
  getEvent,
  updateEvent,
  findAllEventsByConversationId,
  serializeEvent,
} from "../lib/store.js";
import { sendHeyReachMessage } from "../lib/heyreach.js";
import { requireAuth } from "../lib/auth.js";
import {
  enrichDisplayThread,
  appendOurMessage,
  syncAllLeadConversationEvents,
} from "../lib/conversation.js";
import { invalidateChatroomCache } from "../lib/conversation-sync.js";
import { createCalendarEvent } from "../lib/calendar/google.js";
import { isGoogleCalendarConnected } from "../lib/calendar/store.js";
import { isGoogleCalendarSchedulingMode } from "../lib/scheduling/config.js";

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
    let scheduling = event.draft?.scheduling ? { ...event.draft.scheduling } : null;
    let calendarEventId = scheduling?.calendarEventId || null;

    if (scheduling?.pendingBook && isGoogleCalendarSchedulingMode()) {
      try {
        if (await isGoogleCalendarConnected()) {
          const book = scheduling.pendingBook;
          const calEvent = await createCalendarEvent({
            summary: book.title,
            description: book.description,
            start: book.start,
            end: book.end,
            attendees: book.attendees || [],
          });
          calendarEventId = calEvent?.id || null;
          scheduling = {
            ...scheduling,
            status: "booked",
            calendarEventId,
            meetLink: calEvent?.meetLink || null,
            calendarError: null,
          };
        } else {
          console.warn("send-reply: calendar not connected — LinkedIn message sent without booking");
          scheduling = {
            ...scheduling,
            calendarError: "Google Calendar not connected — event was not created",
          };
        }
      } catch (calErr) {
        console.error("send-reply calendar error:", calErr);
        scheduling = {
          ...scheduling,
          calendarError: calErr.message,
        };
      }
    }

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
      draft: { ...(event.draft || {}), reply: replyText, scheduling },
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
    return jsonResponse(res, 200, { ok: true, event: serializeEvent(refreshed || updated) });
  } catch (error) {
    console.error("send-reply error:", error);
    return jsonResponse(res, 500, { error: "Failed to send via HeyReach" });
  }
}
