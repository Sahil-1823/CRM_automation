import { parseHeyReachPayload, verifyHeyReachSecret } from "../lib/heyreach.js";
import { readJsonBody, jsonResponse } from "../lib/http.js";
import { classifyReplySentiment } from "../lib/sentiment.js";
import {
  isDraftGenerationEnabled,
  generateDraftForLead,
  emptyDraft,
} from "../lib/draft-pipeline.js";
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

    let draftProjectId = "all";
    let project = { id: null, name: "All projects", source: "auto" };
    let draft = emptyDraft({ skipped: !isDraftGenerationEnabled() });

    if (isDraftGenerationEnabled()) {
      try {
        const result = await generateDraftForLead({
          lead: parsed.lead,
          sentiment,
        });
        draft = result.draft;
        draftProjectId = result.draftProjectId;
        project = result.project;
      } catch (err) {
        draft = emptyDraft({ error: err.message });
      }
    }

    const record = await saveEvent({
      lead: parsed.lead,
      linkedInAccount: parsed.lead.linkedInAccountId
        ? {
            linkedInAccountId: parsed.lead.linkedInAccountId,
            name: parsed.lead.linkedInAccountName || null,
          }
        : null,
      campaign:
        parsed.lead.campaignId || parsed.lead.campaignName
          ? {
              id: parsed.lead.campaignId ?? null,
              name: parsed.lead.campaignName || null,
            }
          : null,
      messageType: parsed.lead.messageType || parsed.lead.eventType || null,
      sentiment: {
        label: sentiment.sentiment,
        isPositive: sentiment.isPositive,
        reasoning: sentiment.reasoning,
      },
      draftProjectId,
      project,
      draft,
      status: "pending_review",
    });

    return jsonResponse(res, 200, {
      ok: true,
      action: "pending_review",
      eventId: record.id,
      sentiment: sentiment.sentiment,
      draftEnabled: isDraftGenerationEnabled(),
      project: project.id ? { id: project.id, name: project.name } : null,
    });
  } catch (error) {
    console.error("heyreach-webhook error:", error);
    return jsonResponse(res, 500, {
      error: "Internal server error",
      message: error.message,
    });
  }
}
