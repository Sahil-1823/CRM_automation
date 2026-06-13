import { parseHeyReachPayload, verifyHeyReachSecret } from "../lib/heyreach.js";
import { readJsonBody, jsonResponse } from "../lib/http.js";
import { classifyReplySentiment } from "../lib/sentiment.js";
import { pushPositiveLeadToCrm } from "../lib/crm/index.js";
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

    if (!sentiment.isPositive) {
      return jsonResponse(res, 200, {
        ok: true,
        action: "dropped",
        sentiment: sentiment.sentiment,
        reasoning: sentiment.reasoning,
      });
    }

    const crmResult = await pushPositiveLeadToCrm(parsed.lead);

    return jsonResponse(res, 200, {
      ok: true,
      action: "crm_push",
      sentiment: sentiment.sentiment,
      reasoning: sentiment.reasoning,
      crm: crmResult,
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
