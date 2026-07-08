import { jsonResponse, readJsonBody } from "../http.js";
import { requireAuth } from "../auth.js";
import {
  listHeyReachAccounts,
  getHeyReachAccount,
  saveHeyReachAccount,
  updateHeyReachAccount,
  removeHeyReachAccount,
  serializeHeyReachAccountForDashboard,
  slugifyHeyReachAccountId,
  generateWebhookSecret,
  DEFAULT_ACCOUNT_ID,
} from "../heyreach/accounts-store.js";

function requestBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
  return `${proto}://${host}`;
}

export default async function handler(req, res) {
  try {
    if (!(await requireAuth(req, res))) return;
    const baseUrl = requestBaseUrl(req);

    if (req.method === "GET") {
      const accounts = await listHeyReachAccounts({ includeSynthetic: true });
      return jsonResponse(res, 200, {
        accounts: accounts.map((account) =>
          serializeHeyReachAccountForDashboard(account, { baseUrl }),
        ),
      });
    }

    if (req.method === "POST") {
      const body = await readJsonBody(req);
      if (!body.label?.trim() && !body.id?.trim()) {
        return jsonResponse(res, 400, { error: "Missing label or id" });
      }
      if (!body.apiKey?.trim()) {
        return jsonResponse(res, 400, { error: "Missing apiKey" });
      }

      const id = body.id?.trim() || slugifyHeyReachAccountId(body.label);
      if (id === DEFAULT_ACCOUNT_ID) {
        return jsonResponse(res, 400, { error: `Reserved account id: ${DEFAULT_ACCOUNT_ID}` });
      }

      const existing = await getHeyReachAccount(id);
      if (existing && !existing.isSynthetic) {
        return jsonResponse(res, 409, { error: `Account already exists: ${id}` });
      }

      const saved = await saveHeyReachAccount({
        id,
        label: body.label?.trim() || id,
        apiKey: body.apiKey.trim(),
        webhookSecret: body.webhookSecret?.trim() || generateWebhookSecret(),
        projectId: body.projectId || null,
        calendlyLink: body.calendlyLink?.trim() || null,
      });

      return jsonResponse(res, 201, {
        ok: true,
        account: serializeHeyReachAccountForDashboard(saved, { baseUrl }),
      });
    }

    const url = new URL(req.url, "http://localhost");
    const id = url.searchParams.get("id");
    if (!id) return jsonResponse(res, 400, { error: "Missing ?id=" });

    if (req.method === "PATCH") {
      const body = await readJsonBody(req);
      const updated = await updateHeyReachAccount(id, body);
      return jsonResponse(res, 200, {
        ok: true,
        account: serializeHeyReachAccountForDashboard(updated, { baseUrl }),
      });
    }

    if (req.method === "DELETE") {
      await removeHeyReachAccount(id);
      return jsonResponse(res, 200, { ok: true });
    }

    return jsonResponse(res, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error("heyreach-accounts error:", error);
    return jsonResponse(res, 500, { error: error.message || "Failed to manage HeyReach accounts" });
  }
}
