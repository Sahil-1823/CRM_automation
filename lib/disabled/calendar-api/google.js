/**
 * Google Calendar OAuth API — disabled (not deployed as a Vercel function).
 * Restore to api/auth/google.js to re-enable. Use SCHEDULING_MODE=gcal + Calendly off.
 */
import { jsonResponse } from "../../http.js";
import { requireAuth, parseCookie, verifySessionToken } from "../../auth.js";
import {
  getGoogleRedirectUri,
  GOOGLE_CALENDAR_SCOPE,
  isGoogleOAuthConfigured,
} from "../../calendar/config.js";
import {
  exchangeCodeForTokens,
  fetchGoogleUserEmail,
} from "../../calendar/google.js";
import { saveGoogleOAuthTokens, clearGoogleOAuthTokens } from "../../calendar/store.js";
import { getRedis } from "../../store.js";

const OAUTH_STATE_PREFIX = "crm:gcal:oauth_state:";

async function saveOAuthState(state, sessionUsername) {
  const redis = getRedis();
  if (!redis) throw new Error("Redis required for OAuth state");
  await redis.set(`${OAUTH_STATE_PREFIX}${state}`, { username: sessionUsername }, { ex: 600 });
}

async function consumeOAuthState(state) {
  const redis = getRedis();
  if (!redis) return null;
  const key = `${OAUTH_STATE_PREFIX}${state}`;
  const value = await redis.get(key);
  if (value) await redis.del(key);
  return value;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return jsonResponse(res, 405, { error: "Method not allowed" });
  }

  try {
    const url = new URL(req.url, "http://localhost");
    const action = url.searchParams.get("action") || "connect";

    if (!isGoogleOAuthConfigured()) {
      return jsonResponse(res, 503, { error: "Google Calendar OAuth is not configured" });
    }

    if (action === "connect") {
      const session = await requireAuth(req, res);
      if (!session) return;

      const state = crypto.randomUUID();
      await saveOAuthState(state, session.username);

      const redirectUri = getGoogleRedirectUri(req);
      const { clientId } = (await import("../../calendar/config.js")).getGoogleCalendarConfig();
      const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authUrl.searchParams.set("client_id", clientId);
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("scope", GOOGLE_CALENDAR_SCOPE);
      authUrl.searchParams.set("access_type", "offline");
      authUrl.searchParams.set("prompt", "consent");
      authUrl.searchParams.set("state", state);

      res.writeHead(302, { Location: authUrl.toString() });
      res.end();
      return;
    }

    if (action === "callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      if (error) {
        res.writeHead(302, { Location: `/?gcal_error=${encodeURIComponent(error)}` });
        res.end();
        return;
      }

      if (!code || !state) {
        return jsonResponse(res, 400, { error: "Missing code or state" });
      }

      const stateRecord = await consumeOAuthState(state);
      if (!stateRecord) {
        return jsonResponse(res, 400, { error: "Invalid or expired OAuth state" });
      }

      const token = parseCookie(req.headers.cookie);
      const session = await verifySessionToken(token);
      if (!session || session.username !== stateRecord.username) {
        return jsonResponse(res, 401, { error: "Session required to complete Google connect" });
      }

      const redirectUri = getGoogleRedirectUri(req);
      const tokens = await exchangeCodeForTokens({ code, redirectUri });
      const email = await fetchGoogleUserEmail(tokens.access_token);

      await saveGoogleOAuthTokens({
        refreshToken: tokens.refresh_token || null,
        accessToken: tokens.access_token,
        expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
        email,
        scope: GOOGLE_CALENDAR_SCOPE,
      });

      res.writeHead(302, { Location: "/?gcal_connected=1" });
      res.end();
      return;
    }

    if (action === "disconnect") {
      if (!(await requireAuth(req, res))) return;
      await clearGoogleOAuthTokens();
      return jsonResponse(res, 200, { ok: true, connected: false });
    }

    return jsonResponse(res, 400, { error: "Unknown action" });
  } catch (error) {
    console.error("google auth error:", error);
    return jsonResponse(res, 500, { error: "Google Calendar auth failed" });
  }
}
