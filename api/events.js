import { jsonResponse, readJsonBody } from "../lib/http.js";
import { listEvents, getEvent, updateEvent, isUsingRedis } from "../lib/store.js";
import { requireAuth } from "../lib/auth.js";
import { resolveLinkedInAccount, getAccount } from "../lib/accounts.js";

async function applyLinkedInAccountPatch(current, body) {
  if (body.accountId === undefined && body.linkedInAccountId === undefined) {
    return {};
  }

  let linkedInAccountId = body.linkedInAccountId;
  let accountId = body.accountId;

  if (accountId) {
    const account = await getAccount(accountId);
    if (!account) throw new Error(`Account not found: ${accountId}`);
    return {
      linkedInAccount: {
        accountId: account.id,
        linkedInAccountId: account.linkedInAccountId,
        label: account.label,
      },
      lead: {
        ...(current.lead || {}),
        linkedInAccountId: account.linkedInAccountId,
      },
    };
  }

  if (linkedInAccountId != null && linkedInAccountId !== "") {
    const resolved = await resolveLinkedInAccount(linkedInAccountId);
    if (!resolved) throw new Error("Invalid LinkedIn account ID");
    return {
      linkedInAccount: resolved,
      lead: {
        ...(current.lead || {}),
        linkedInAccountId: resolved.linkedInAccountId,
      },
    };
  }

  return {
    linkedInAccount: null,
    lead: { ...(current.lead || {}), linkedInAccountId: null },
  };
}

export default async function handler(req, res) {
  try {
    if (!(await requireAuth(req, res))) return;
    const url = new URL(req.url, "http://localhost");
    const id = url.searchParams.get("id");

    if (req.method === "GET") {
      if (id) {
        const event = await getEvent(id);
        if (!event) return jsonResponse(res, 404, { error: "Not found" });
        return jsonResponse(res, 200, { event });
      }
      const status = url.searchParams.get("status") || undefined;
      const limit = Number(url.searchParams.get("limit") || 100);
      const events = await listEvents({ status, limit });
      return jsonResponse(res, 200, {
        events,
        storage: isUsingRedis() ? "redis" : "file",
      });
    }

    if (req.method === "PATCH") {
      if (!id) return jsonResponse(res, 400, { error: "Missing ?id=" });
      const body = await readJsonBody(req);
      const current = await getEvent(id);
      if (!current) return jsonResponse(res, 404, { error: "Not found" });

      const patch = {};
      if (typeof body.draftReply === "string") {
        patch.draft = { ...(current.draft || {}), reply: body.draftReply };
      }
      if (typeof body.status === "string") patch.status = body.status;

      const accountPatch = await applyLinkedInAccountPatch(current, body);
      Object.assign(patch, accountPatch);

      const updated = await updateEvent(id, patch);
      return jsonResponse(res, 200, { event: updated });
    }

    return jsonResponse(res, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error("events api error:", error);
    return jsonResponse(res, 500, {
      error: "Internal server error",
      message: error.message,
    });
  }
}
