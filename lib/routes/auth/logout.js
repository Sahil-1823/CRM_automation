import { jsonResponse } from "../http.js";
import { clearSessionCookieHeader } from "../auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return jsonResponse(res, 405, { error: "Method not allowed" });
  }

  res.setHeader("Set-Cookie", clearSessionCookieHeader());
  return jsonResponse(res, 200, { ok: true });
}
