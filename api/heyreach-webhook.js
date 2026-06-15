import { parseHeyReachPayload, verifyHeyReachSecret } from "../lib/heyreach.js";
import { readJsonBody, jsonResponse } from "../lib/http.js";
import { classifyReplySentiment } from "../lib/sentiment.js";
import { generateDraftReply } from "../lib/reply.js";
import { saveEvent } from "../lib/store.js";
import { getConfig } from "../lib/config.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return jsonResponse(res, 405, { error: "Method not allowed" });
  }

  try {
    const config = getConfig();

    if (!verifyHeyReachSecret(req, config.heyreach.webhookSecret)) {
      return jsonResponse(res, 401, { error: "Unauthorized" });
    }

    const payload = await readJsonBody(req);
    const parsed = parseHeyReachPayload(payload);

    if (!parsed.valid) {
      return jsonResponse(res, 400, {
        error: "Invalid HeyReach payload",
        missing: parsed.errors,
      });
    }

    const sentiment = await classifyReplySentiment({
      replyMessage: parsed.lead.replyMessage,
      yourMessage: parsed.lead.yourMessage,
      leadName: parsed.lead.fullName,
      companyName: parsed.lead.companyName,
    });

    let draft = null;
    let draftError = null;
    try {
      draft = await generateDraftReply({
        replyMessage: parsed.lead.replyMessage,
        yourMessage: parsed.lead.yourMessage,
        leadName: parsed.lead.fullName,
        companyName: parsed.lead.companyName,
        jobTitle: parsed.lead.jobTitle,
        sentiment: sentiment.sentiment,
        isPositive: sentiment.isPositive,
        conversation: parsed.lead.conversation,
      });
    } catch (err) {
      draftError = err.message;
    }

    const record = await saveEvent({
      lead: parsed.lead,
      sentiment: {
        label: sentiment.sentiment,
        isPositive: sentiment.isPositive,
        reasoning: sentiment.reasoning,
      },
      draft: draft
        ? {
            reply: draft.reply,
            rationale: draft.rationale,
            ragSources: draft.ragSources,
            error: null,
          }
        : { reply: "", rationale: "", ragSources: [], error: draftError },
      status: "pending_review",
    });

    return jsonResponse(res, 200, {
      ok: true,
      action: "pending_review",
      eventId: record.id,
      sentiment: sentiment.sentiment,
    });
  } catch (error) {
    console.error("heyreach-webhook error:", error);
    return jsonResponse(res, 500, {
      error: "Internal server error",
      message: error.message,
    });
  }
}
