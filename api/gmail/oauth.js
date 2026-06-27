import { jsonResponse } from "../../lib/http.js";
import { requireAuth, parseCookie, verifySessionToken } from "../../lib/auth.js";
import {
  getGmailRedirectUri,
  GMAIL_SCOPES,
  isGmailOAuthConfigured,
  getGmailConfig,
} from "../../lib/gmail/config.js";
import {
  exchangeCodeForTokens,
  fetchGoogleUserEmail,
  watchInbox,
  stopWatch,
} from "../../lib/gmail/oauth.js";
import {
  saveGmailAccount,
  removeGmailAccount,
  saveOAuthState,
  consumeOAuthState,
  getGmailAccount,
} from "../../lib/gmail/store.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return jsonResponse(res, 405, { error: "Method not allowed" });
  }

  try {
    const url = new URL(req.url, "http://localhost");
    const action = url.searchParams.get("action") || "connect";

    if (!isGmailOAuthConfigured()) {
      return jsonResponse(res, 503, { error: "Gmail OAuth is not configured" });
    }

    if (action === "connect") {
      const session = await requireAuth(req, res);
      if (!session) return;

      const state = crypto.randomUUID();
      await saveOAuthState(state, { username: session.username });

      const redirectUri = getGmailRedirectUri(req);
      const { clientId } = getGmailConfig();
      const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authUrl.searchParams.set("client_id", clientId);
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("scope", GMAIL_SCOPES);
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
        res.writeHead(302, { Location: `/?gmail_error=${encodeURIComponent(error)}` });
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
        return jsonResponse(res, 401, { error: "Session required to complete Gmail connect" });
      }

      const redirectUri = getGmailRedirectUri(req);
      const tokens = await exchangeCodeForTokens({ code, redirectUri });
      const email = await fetchGoogleUserEmail(tokens.access_token);
      if (!email) {
        return jsonResponse(res, 500, { error: "Could not read Gmail account email" });
      }

      await saveGmailAccount({
        email,
        refreshToken: tokens.refresh_token || null,
        accessToken: tokens.access_token,
        expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
        historyId: null,
        watchExpiration: null,
        autoSend: false,
        connectedAt: new Date().toISOString(),
      });

      const { pubsubTopic } = getGmailConfig();
      if (pubsubTopic) {
        try {
          const watch = await watchInbox(email, pubsubTopic);
          await saveGmailAccount({
            email,
            refreshToken: tokens.refresh_token || null,
            accessToken: tokens.access_token,
            expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
            historyId: watch?.historyId ? String(watch.historyId) : null,
            watchExpiration: watch?.expiration ? Number(watch.expiration) : null,
            autoSend: false,
            connectedAt: new Date().toISOString(),
          });
        } catch (watchErr) {
          console.error("gmail watch failed:", watchErr);
        }
      }

      res.writeHead(302, { Location: "/?gmail_connected=1" });
      res.end();
      return;
    }

    if (action === "disconnect") {
      if (!(await requireAuth(req, res))) return;
      const email = url.searchParams.get("email");
      if (!email) return jsonResponse(res, 400, { error: "Missing ?email=" });

      try {
        await stopWatch(email);
      } catch {
        /* ignore */
      }
      await removeGmailAccount(email);
      return jsonResponse(res, 200, { ok: true, disconnected: email });
    }

    return jsonResponse(res, 400, { error: "Unknown action" });
  } catch (error) {
    console.error("gmail oauth error:", error);
    return jsonResponse(res, 500, { error: "Gmail OAuth failed" });
  }
}
