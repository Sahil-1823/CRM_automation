import { jsonResponse, readJsonBody } from "../../lib/http.js";
import { requireAuth } from "../../lib/auth.js";
import { listGmailAccounts, getGmailAccount, updateGmailAccount } from "../../lib/gmail/store.js";
import { isGmailOAuthConfigured } from "../../lib/gmail/config.js";

export default async function handler(req, res) {
  try {
    if (!(await requireAuth(req, res))) return;

    if (req.method === "GET") {
      const configured = isGmailOAuthConfigured();
      const emails = configured ? await listGmailAccounts() : [];
      const accounts = [];
      for (const email of emails) {
        const account = await getGmailAccount(email);
        if (account) {
          accounts.push({
            email: account.email,
            autoSend: !!account.autoSend,
            connectedAt: account.connectedAt ?? null,
            watchExpiration: account.watchExpiration ?? null,
            historyId: account.historyId ?? null,
          });
        }
      }
      return jsonResponse(res, 200, { configured, accounts });
    }

    if (req.method === "PATCH") {
      const body = await readJsonBody(req);
      const email = body.email;
      if (!email) return jsonResponse(res, 400, { error: "Missing email" });

      const account = await getGmailAccount(email);
      if (!account) return jsonResponse(res, 404, { error: "Account not found" });

      const patch = {};
      if (typeof body.autoSend === "boolean") patch.autoSend = body.autoSend;

      const updated = await updateGmailAccount(email, patch);
      return jsonResponse(res, 200, {
        ok: true,
        account: {
          email: updated.email,
          autoSend: !!updated.autoSend,
        },
      });
    }

    return jsonResponse(res, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error("gmail accounts error:", error);
    return jsonResponse(res, 500, { error: "Failed to load Gmail accounts" });
  }
}
