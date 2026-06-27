import { jsonResponse, readJsonBody } from "../../http.js";
import { requireAuth } from "../../auth.js";
import {
  listGmailAccounts,
  getGmailAccount,
  saveGmailAccount,
} from "../../gmail/store.js";

export default async function handler(req, res) {
  try {
    if (!(await requireAuth(req, res))) return;

    if (req.method === "GET") {
      const emails = await listGmailAccounts();
      const accounts = [];
      for (const email of emails) {
        const account = await getGmailAccount(email);
        if (account) {
          accounts.push({
            email: account.email,
            autoSend: !!account.autoSend,
            connectedAt: account.connectedAt || null,
            watchExpiration: account.watchExpiration || null,
          });
        }
      }
      return jsonResponse(res, 200, { accounts });
    }

    if (req.method === "PATCH") {
      const body = await readJsonBody(req);
      const email = body.email;
      if (!email) return jsonResponse(res, 400, { error: "Missing email" });

      const account = await getGmailAccount(email);
      if (!account) return jsonResponse(res, 404, { error: "Account not found" });

      if (typeof body.autoSend === "boolean") {
        await saveGmailAccount({ ...account, autoSend: body.autoSend });
      }
      return jsonResponse(res, 200, { ok: true });
    }

    return jsonResponse(res, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error("gmail accounts error:", error);
    return jsonResponse(res, 500, { error: "Failed to manage Gmail accounts" });
  }
}
