import { jsonResponse } from "../../lib/http.js";
import { requireAuth } from "../../lib/auth.js";
import { getGoogleOAuthTokens } from "../../lib/calendar/store.js";
import { isGoogleOAuthConfigured } from "../../lib/calendar/config.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return jsonResponse(res, 405, { error: "Method not allowed" });
  }

  try {
    if (!(await requireAuth(req, res))) return;

    const configured = isGoogleOAuthConfigured();
    const tokens = configured ? await getGoogleOAuthTokens() : null;
    const connected = Boolean(tokens?.refreshToken);

    return jsonResponse(res, 200, {
      configured,
      connected,
      email: connected ? tokens.email || null : null,
    });
  } catch (error) {
    console.error("google-status error:", error);
    return jsonResponse(res, 500, { error: "Failed to load Google Calendar status" });
  }
}
