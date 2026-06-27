import { getGmailConfig } from "./config.js";
import { getGmailAccount, saveGmailAccount } from "./store.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";

export async function exchangeCodeForTokens({ code, redirectUri }) {
  const { clientId, clientSecret } = getGmailConfig();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    throw new Error(`Gmail token exchange failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

export async function refreshAccessToken(refreshToken) {
  const { clientId, clientSecret } = getGmailConfig();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    throw new Error(`Gmail token refresh failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

export async function fetchGoogleUserEmail(accessToken) {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.email || null;
}

export async function getValidAccessToken(accountEmail) {
  const stored = await getGmailAccount(accountEmail);
  if (!stored?.refreshToken) {
    throw new Error(`Gmail account not connected: ${accountEmail}`);
  }

  const now = Date.now();
  if (stored.accessToken && stored.expiresAt && stored.expiresAt > now + 60_000) {
    return stored.accessToken;
  }

  const refreshed = await refreshAccessToken(stored.refreshToken);
  const accessToken = refreshed.access_token;
  const expiresAt = Date.now() + (refreshed.expires_in || 3600) * 1000;
  await saveGmailAccount({
    ...stored,
    accessToken,
    expiresAt,
  });
  return accessToken;
}

async function gmailFetch(accountEmail, path, { method = "GET", body, query = {} } = {}) {
  const accessToken = await getValidAccessToken(accountEmail);
  const qs = new URLSearchParams(query).toString();
  const url = `${GMAIL_API}${path}${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`Gmail API ${method} ${path} failed (${res.status}): ${await res.text()}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export async function watchInbox(accountEmail, topicName) {
  return gmailFetch(accountEmail, "/users/me/watch", {
    method: "POST",
    body: {
      topicName,
      labelIds: ["INBOX"],
    },
  });
}

export async function stopWatch(accountEmail) {
  return gmailFetch(accountEmail, "/users/me/stop", { method: "POST", body: {} });
}

export async function listHistory(accountEmail, startHistoryId) {
  return gmailFetch(accountEmail, "/users/me/history", {
    query: {
      startHistoryId: String(startHistoryId),
      historyTypes: "messageAdded",
    },
  });
}

export async function getMessage(accountEmail, messageId, format = "full") {
  return gmailFetch(accountEmail, `/users/me/messages/${messageId}`, {
    query: { format },
  });
}

export async function getThread(accountEmail, threadId) {
  return gmailFetch(accountEmail, `/users/me/threads/${threadId}`, {
    query: { format: "full" },
  });
}

export async function sendRawMessage(accountEmail, { raw, threadId }) {
  return gmailFetch(accountEmail, "/users/me/messages/send", {
    method: "POST",
    body: threadId ? { raw, threadId } : { raw },
  });
}

export async function modifyMessageLabels(accountEmail, messageId, { addLabelIds = [], removeLabelIds = [] }) {
  return gmailFetch(accountEmail, `/users/me/messages/${messageId}/modify`, {
    method: "POST",
    body: { addLabelIds, removeLabelIds },
  });
}

export async function listLabels(accountEmail) {
  const data = await gmailFetch(accountEmail, "/users/me/labels");
  return data?.labels || [];
}

export async function createLabel(accountEmail, name) {
  return gmailFetch(accountEmail, "/users/me/labels", {
    method: "POST",
    body: {
      name,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    },
  });
}
