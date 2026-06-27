import { jsonResponse } from "../../lib/http.js";

const HANDLERS = {
  events: () => import("../../lib/dashboard/events.js"),
  projects: () => import("../../lib/dashboard/projects.js"),
  documents: () => import("../../lib/dashboard/documents.js"),
  "regenerate-draft": () => import("../../lib/dashboard/regenerate-draft.js"),
  "raw-webhooks": () => import("../../lib/dashboard/raw-webhooks.js"),
  "sync-conversation": () => import("../../lib/dashboard/sync-conversation.js"),
  "heyreach-meta": () => import("../../lib/dashboard/heyreach-meta.js"),
};

export default async function handler(req, res) {
  let action = req.query?.action;
  if (Array.isArray(action)) action = action.join("/");
  if (!action) {
    const url = new URL(req.url || "/", "http://localhost");
    const parts = url.pathname.replace(/^\/api\/dashboard\/?/, "").split("/").filter(Boolean);
    action = parts[0] || "";
  }

  const load = HANDLERS[action];
  if (!load) {
    return jsonResponse(res, 404, { error: "Not found", action: action || null });
  }

  const mod = await load();
  return mod.default(req, res);
}
