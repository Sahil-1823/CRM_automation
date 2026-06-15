import { readJsonBody, jsonResponse } from "../../lib/http.js";
import { verifyAdminPassword, createSessionToken, sessionCookieHeader } from "../../lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return jsonResponse(res, 405, { error: "Method not allowed" });
  }

  try {
    const body = await readJsonBody(req);
    const password = String(body.password || "");

    if (!verifyAdminPassword(password)) {
      return jsonResponse(res, 401, { error: "Incorrect admin password" });
    }

    const token = await createSessionToken();
    res.setHeader("Set-Cookie", sessionCookieHeader(token));
    return jsonResponse(res, 200, { ok: true });
  } catch (error) {
    console.error("admin login error:", error);
    return jsonResponse(res, 500, {
      error: "Login failed",
      message: error.message,
    });
  }
}
