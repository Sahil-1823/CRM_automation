import { parseHeyReachPayload, verifyHeyReachSecret } from "../lib/heyreach.js";
import { readJsonBody, jsonResponse } from "../lib/http.js";
import { classifyReplySentiment } from "../lib/sentiment.js";
import { generateDraftReply } from "../lib/reply.js";
import { saveEvent } from "../lib/store.js";
import { notifySlackError } from "../lib/slack.js";
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

    // Draft a suggested reply for the operator to review.
    // Don't fail the webhook if drafting errors — just record the event without a draft.
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
        ? { reply: draft.reply, rationale: draft.rationale, error: null }
        : { reply: "", rationale: "", error: draftError },
      status: "pending_review",
      rawPayloadSummary: {
        campaignName: parsed.lead.campaignName,
        conversationId: parsed.lead.conversationId,
        eventType: parsed.lead.eventType,
      },
    });

    return jsonResponse(res, 200, {
      ok: true,
      action: "queued_for_review",
      eventId: record.id,
      sentiment: sentiment.sentiment,
    });
  } catch (error) {
    console.error("heyreach-webhook error:", error);

    try {
      await notifySlackError(error.message, {
        endpoint: "/api/heyreach-webhook",
        stack: error.stack,
      });
    } catch (notifyError) {
      console.error("Failed to notify Slack about webhook error:", notifyError);
    }

    return jsonResponse(res, 500, {
      error: "Internal server error",
      message: error.message,
    });
  }
}
