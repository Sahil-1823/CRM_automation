import { jsonResponse, readJsonBody } from "../../lib/http.js";
import { getEvent, serializeEvent } from "../../lib/store.js";
import { requireAuth } from "../../lib/auth.js";
import { deliverGmailReply } from "../../lib/gmail/deliver.js";

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
    if (event.channel !== "gmail") {
      return jsonResponse(res, 400, { error: "Not a Gmail event" });
    }
    if (event.status === "sent") {
      return jsonResponse(res, 409, { error: "Event already sent" });
    }

    const replyText = (body.reply ?? event.draft?.reply ?? "").trim();
    if (!replyText) {
      return jsonResponse(res, 400, { error: "Reply text is empty" });
    }

    const updated = await deliverGmailReply(event, replyText);
    return jsonResponse(res, 200, { ok: true, event: serializeEvent(updated) });
  } catch (error) {
    console.error("gmail send-reply error:", error);
    return jsonResponse(res, 500, { error: "Failed to send via Gmail" });
  }
}
