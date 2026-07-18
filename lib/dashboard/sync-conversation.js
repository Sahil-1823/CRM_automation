import { jsonResponse } from "../http.js";
import { serializeEvent } from "../store.js";
import { requireAuth } from "../auth.js";
import { syncHeyReachConversationByEventId } from "./sync-conversation-core.js";
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

    const result = await syncHeyReachConversationByEventId(id);
    if (!result.synced && result.event?.channel !== "gmail") {
      const lead = result.event?.lead || {};
      if (!lead.conversationId || !(lead.linkedInAccountId ?? result.event?.linkedInAccount?.linkedInAccountId)) {
        return jsonResponse(res, 400, {
          error: "Missing conversationId or linkedInAccountId on this event",
        });
      }
    }

    return jsonResponse(res, 200, {
      ok: true,
      event: serializeEvent(result.event),
      messages: result.messages,
      eventsUpdated: result.eventsUpdated,
    });
  } catch (error) {
    console.error("sync-conversation error:", error);
    log("error", "conversation.sync_failed", { error: error.message });
    return jsonResponse(res, 500, { error: "Failed to sync conversation" });
  }
}
