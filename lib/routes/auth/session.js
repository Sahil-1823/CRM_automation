import { jsonResponse } from "../http.js";
import { requireAuth } from "../auth.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return jsonResponse(res, 405, { error: "Method not allowed" });
  }

  const session = await requireAuth(req, res);
  if (!session) return;

  return jsonResponse(res, 200, { ok: true, username: session.username });
}
