import { jsonResponse, readJsonBody } from "../lib/http.js";
import { getEvent, updateEvent } from "../lib/store.js";
import { sendHeyReachMessage } from "../lib/heyreach.js";
import { requireAuth } from "../lib/auth.js";
import { getAccount } from "../lib/accounts.js";

function resolveSendAccountId(event, body) {
  if (body.accountId) {
    return { accountId: body.accountId, linkedInAccountId: null };
  }
  if (body.linkedInAccountId != null && body.linkedInAccountId !== "") {
    return { accountId: null, linkedInAccountId: Number(body.linkedInAccountId) };
  }
  if (event.linkedInAccount?.linkedInAccountId) {
    return {
      accountId: event.linkedInAccount.accountId,
      linkedInAccountId: event.linkedInAccount.linkedInAccountId,
    };
  }
  const leadId = event.lead?.linkedInAccountId;
  if (leadId != null) {
    return { accountId: null, linkedInAccountId: Number(leadId) };
  }
  return { accountId: null, linkedInAccountId: null };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return jsonResponse(res, 405, { error: "Method not allowed" });
  }

  try {
    if (!(await requireAuth(req, res))) return;
    const url = new URL(req.url, "http://localhost");
    const id = url.searchParams.get("id");
    if (!id) return jsonResponse(res, 400, { error: "Missing ?id=" });

    const body = await readJsonBody(req);
    const event = await getEvent(id);
    if (!event) return jsonResponse(res, 404, { error: "Event not found" });
    if (event.status === "sent") {
      return jsonResponse(res, 409, { error: "Event already sent" });
    }

    const replyText = (body.reply ?? event.draft?.reply ?? "").trim();
    if (!replyText) {
      return jsonResponse(res, 400, { error: "Reply text is empty" });
    }

    const lead = event.lead ?? {};
    const { accountId, linkedInAccountId: bodyAccountId } = resolveSendAccountId(event, body);

    let linkedInAccountId = bodyAccountId;
    if (accountId) {
      const account = await getAccount(accountId);
      if (!account) {
        return jsonResponse(res, 400, { error: "Selected LinkedIn account not found" });
      }
      linkedInAccountId = account.linkedInAccountId;
    }

    if (!linkedInAccountId) {
      return jsonResponse(res, 400, {
        error: "Select a LinkedIn account before sending",
      });
    }

    const heyReachResult = await sendHeyReachMessage({
      conversationId: lead.conversationId,
      linkedInAccountId,
      message: replyText,
    });

    const updated = await updateEvent(id, {
      status: "sent",
      sentAt: new Date().toISOString(),
      sendResult: { reply: replyText, heyreach: heyReachResult, linkedInAccountId },
      draft: { ...(event.draft || {}), reply: replyText },
    });

    return jsonResponse(res, 200, { ok: true, event: updated });
  } catch (error) {
    console.error("send-reply error:", error);
    return jsonResponse(res, 500, {
      error: "Failed to send via HeyReach",
      message: error.message,
    });
  }
}
