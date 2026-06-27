import { jsonResponse } from "./http.js";

/** @type {Record<string, () => Promise<{ default: Function }>>} */
const ROUTES = {
  events: () => import("./routes/events.js"),
  "send-reply": () => import("./routes/send-reply.js"),
  "heyreach-webhook": () => import("./routes/heyreach-webhook.js"),
  "heyreach-meta": () => import("./routes/heyreach-meta.js"),
  "regenerate-draft": () => import("./routes/regenerate-draft.js"),
  documents: () => import("./routes/documents.js"),
  projects: () => import("./routes/projects.js"),
  "raw-webhooks": () => import("./routes/raw-webhooks.js"),
  "sync-conversation": () => import("./routes/sync-conversation.js"),
  "auth/login": () => import("./routes/auth/login.js"),
  "auth/logout": () => import("./routes/auth/logout.js"),
  "auth/session": () => import("./routes/auth/session.js"),
  "gmail/oauth": () => import("./routes/gmail/oauth.js"),
  "gmail/webhook": () => import("./routes/gmail/webhook.js"),
  "gmail/send-reply": () => import("./routes/gmail/send-reply.js"),
  "gmail/accounts": () => import("./routes/gmail/accounts.js"),
  "cron/renew-gmail-watches": () => import("./routes/cron/renew-gmail-watches.js"),
};

export function resolveRoutePath(req) {
  const url = new URL(req.url || "/", "http://localhost");

  let segments = req.query?.path;
  if (Array.isArray(segments)) {
    /* Vercel catch-all */
  } else if (typeof segments === "string" && segments) {
    segments = [segments];
  } else {
    segments = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  }

  return segments.join("/");
}

export async function dispatch(req, res) {
  const routeKey = resolveRoutePath(req);
  if (!routeKey) {
    return jsonResponse(res, 404, { error: "Not found", hint: "Missing API route path" });
  }

  const load = ROUTES[routeKey];
  if (!load) {
    return jsonResponse(res, 404, { error: "Not found", route: routeKey });
  }

  const mod = await load();
  return mod.default(req, res);
}

export { ROUTES };
