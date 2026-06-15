import { jsonResponse, readJsonBody } from "../lib/http.js";
import { requireAuth } from "../lib/auth.js";
import {
  listAccounts,
  createAccount,
  updateAccount,
  deleteAccount,
} from "../lib/accounts.js";

export default async function handler(req, res) {
  try {
    if (!(await requireAuth(req, res))) return;

    const url = new URL(req.url, "http://localhost");
    const id = url.searchParams.get("id");

    if (req.method === "GET") {
      return jsonResponse(res, 200, { accounts: await listAccounts() });
    }

    if (req.method === "POST") {
      const body = await readJsonBody(req);
      const account = await createAccount(body);
      return jsonResponse(res, 201, { account });
    }

    if (req.method === "PATCH") {
      if (!id) return jsonResponse(res, 400, { error: "Missing ?id=" });
      const body = await readJsonBody(req);
      const account = await updateAccount(id, body);
      return jsonResponse(res, 200, { account });
    }

    if (req.method === "DELETE") {
      if (!id) return jsonResponse(res, 400, { error: "Missing ?id=" });
      const result = await deleteAccount(id);
      return jsonResponse(res, 200, result);
    }

    return jsonResponse(res, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error("accounts api error:", error);
    return jsonResponse(res, 500, { error: "Internal server error", message: error.message });
  }
}
