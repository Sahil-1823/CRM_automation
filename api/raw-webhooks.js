import { jsonResponse } from "../lib/http.js";
import { requireAuth } from "../lib/auth.js";
import { listRawWebhooks, getRawWebhook } from "../lib/infra.js";

/**
 * Admin debugging endpoint: inspect recently archived HeyReach webhook payloads.
 *
 *   GET /api/raw-webhooks            -> list of summaries (newest first)
 *   GET /api/raw-webhooks?id=<id>    -> full archived payload
 */
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return jsonResponse(res, 405, { error: "Method not allowed" });
  }

  try {
    if (!(await requireAuth(req, res))) return;

    const url = new URL(req.url, "http://localhost");
    const id = url.searchParams.get("id");

    if (id) {
      const record = await getRawWebhook(id);
      if (!record) return jsonResponse(res, 404, { error: "Raw webhook not found" });
      return jsonResponse(res, 200, { record });
    }

    const limit = Math.min(Number(url.searchParams.get("limit") || 50), 200);
    const records = await listRawWebhooks({ limit });
    return jsonResponse(res, 200, { records });
  } catch (error) {
    console.error("raw-webhooks api error:", error);
    return jsonResponse(res, 500, { error: "Failed to load raw webhooks" });
  }
}
