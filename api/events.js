import { jsonResponse, readJsonBody } from "../lib/http.js";
import {
  listEvents,
  getEvent,
  updateEvent,
  clearAllEvents,
  serializeEvent,
  serializeEvents,
} from "../lib/store.js";
import { requireAuth } from "../lib/auth.js";

export default async function handler(req, res) {
  try {
    if (!(await requireAuth(req, res))) return;
    const url = new URL(req.url, "http://localhost");
    const id = url.searchParams.get("id");

    if (req.method === "GET") {
      if (id) {
        const event = await getEvent(id);
        if (!event) return jsonResponse(res, 404, { error: "Not found" });
        return jsonResponse(res, 200, { event: serializeEvent(event) });
      }
      const status = url.searchParams.get("status") || undefined;
      const limit = Number(url.searchParams.get("limit") || 100);
      const events = await listEvents({ status, limit });
      return jsonResponse(res, 200, { events: serializeEvents(events) });
    }

    if (req.method === "PATCH") {
      if (!id) return jsonResponse(res, 400, { error: "Missing ?id=" });
      const body = await readJsonBody(req);
      const current = await getEvent(id);
      if (!current) return jsonResponse(res, 404, { error: "Not found" });

      const patch = {};
      if (typeof body.draftReply === "string") {
        patch.draft = { ...(current.draft || {}), reply: body.draftReply };
      }
      if (typeof body.status === "string") patch.status = body.status;

      const updated = await updateEvent(id, patch);
      return jsonResponse(res, 200, { event: serializeEvent(updated) });
    }

    if (req.method === "DELETE") {
      const all = url.searchParams.get("all");
      if (all !== "1") {
        return jsonResponse(res, 400, {
          error: "Missing confirmation. Use DELETE /api/events?all=1",
        });
      }
      const result = await clearAllEvents();
      return jsonResponse(res, 200, {
        ok: true,
        deleted: result.deleted,
      });
    }

    return jsonResponse(res, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error("events api error:", error);
    return jsonResponse(res, 500, { error: "Internal server error" });
  }
}
