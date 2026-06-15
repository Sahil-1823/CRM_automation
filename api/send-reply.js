import { jsonResponse, readJsonBody } from "../lib/http.js";
import { getEvent, updateEvent } from "../lib/store.js";
import { sendHeyReachMessage } from "../lib/heyreach.js";

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

    const lead = event.lead ?? {};
    const heyReachResult = await sendHeyReachMessage({
      conversationId: lead.conversationId,
      linkedInAccountId: lead.linkedInAccountId,
      message: replyText,
    });

    const updated = await updateEvent(id, {
      status: "sent",
      sentAt: new Date().toISOString(),
      sendResult: { reply: replyText, heyreach: heyReachResult },
      draft: { ...(event.draft || {}), reply: replyText },
    });

    return jsonResponse(res, 200, { ok: true, event: updated });
  } catch (error) {
    console.error("send-reply error:", error);
    return jsonResponse(res, 500, {
      error: "Failed to send via HeyReach",
      message: error.message,
    });
  }
}
