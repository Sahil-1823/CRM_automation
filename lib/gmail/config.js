function optional(name, fallback = "") {
  return process.env[name] ?? fallback;
}

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
].join(" ");

export const HANDLED_LABEL_NAME = "crm-handled";
export const MAX_MESSAGES_PER_WEBHOOK = 5;

export function getGmailConfig() {
  return {
    clientId: optional("GMAIL_CLIENT_ID") || optional("GOOGLE_CLIENT_ID"),
    clientSecret: optional("GMAIL_CLIENT_SECRET") || optional("GOOGLE_CLIENT_SECRET"),
    pubsubTopic: optional("GMAIL_PUBSUB_TOPIC"),
    webhookSecret: optional("GMAIL_WEBHOOK_SECRET"),
  };
}

export function isGmailOAuthConfigured() {
  const { clientId, clientSecret } = getGmailConfig();
  return Boolean(clientId && clientSecret);
}

export function getGmailRedirectUri(req) {
  if (process.env.GMAIL_OAUTH_REDIRECT) {
    return process.env.GMAIL_OAUTH_REDIRECT;
  }
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost:3000";
  const proto = req.headers["x-forwarded-proto"] || (host.includes("localhost") ? "http" : "https");
  return `${proto}://${host}/api/gmail/oauth?action=callback`;
}
