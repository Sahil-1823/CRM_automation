import { jsonResponse, readJsonBody } from "../lib/http.js";
import { getEvent, updateEvent } from "../lib/store.js";
import { pushPositiveLeadToCrm } from "../lib/crm/index.js";
import { notifySlack, notifySlackError } from "../lib/slack.js";

// Optional: HeyReach Send Message API (if you have a key + conversation id).
// Docs: https://documenter.getpostman.com/view/23808049/2s9YyzddC2
async function sendViaHeyReach({ conversationId, message }) {
  const apiKey = process.env.HEYREACH_API_KEY;
  if (!apiKey) return { sent: false, reason: "HEYREACH_API_KEY not set" };
  if (!conversationId) return { sent: false, reason: "Missing conversationId" };

  const res = await fetch("https://api.heyreach.io/api/public/inbox/SendMessage", {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ conversationId, message }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HeyReach send failed (${res.status}): ${body}`);
  }
  return { sent: true };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return jsonResponse(res, 405, { error: "Method not allowed" });
  }

  try {
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

    const result = { reply: replyText, pushedToCrm: false, sentToHeyReach: null };

    // 1. Send the reply (HeyReach if configured, otherwise Slack notification).
    try {
      result.sentToHeyReach = await sendViaHeyReach({
        conversationId: event.lead?.conversationId,
        message: replyText,
      });
    } catch (err) {
      result.sentToHeyReach = { sent: false, reason: err.message };
    }

    if (!result.sentToHeyReach.sent) {
      // Fall back to dropping the approved reply into Slack so the human can copy/paste.
      try {
        await notifySlack(
          `:outbox_tray: *Approved reply for ${event.lead?.fullName || "lead"}*\n` +
            `LinkedIn: ${event.lead?.linkedInUrl || "n/a"}\n\n${replyText}`,
        );
        result.sentViaSlack = true;
      } catch (slackErr) {
        result.sentViaSlack = false;
        result.slackError = slackErr.message;
      }
    }

    // 2. Push positive leads to CRM (mirrors the original auto behaviour).
    if (event.sentiment?.isPositive) {
      try {
        const crmResult = await pushPositiveLeadToCrm(event.lead);
        result.pushedToCrm = true;
        result.crm = crmResult;
      } catch (err) {
        result.pushedToCrm = false;
        result.crmError = err.message;
      }
    }

    const updated = await updateEvent(id, {
      status: "sent",
      sentAt: new Date().toISOString(),
      sendResult: result,
      draft: { ...(event.draft || {}), reply: replyText },
    });

    return jsonResponse(res, 200, { ok: true, event: updated });
  } catch (error) {
    console.error("send-reply error:", error);
    try {
      await notifySlackError(error.message, { endpoint: "/api/send-reply" });
    } catch {
      /* ignore */
    }
    return jsonResponse(res, 500, {
      error: "Internal server error",
      message: error.message,
    });
  }
}
