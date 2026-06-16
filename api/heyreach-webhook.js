import { parseHeyReachPayload, verifyHeyReachSecret } from "../lib/heyreach.js";
import { readJsonBody, jsonResponse } from "../lib/http.js";
import { classifyReplySentiment } from "../lib/sentiment.js";
import {
  isDraftGenerationEnabled,
  generateDraftForLead,
  emptyDraft,
} from "../lib/draft-pipeline.js";
import { saveEvent, findEventByConversationId, updateEvent } from "../lib/store.js";
import { getConfig } from "../lib/config.js";
import {
  mergeConversationHistory,
  enrichDisplayThread,
  conversationFromEvent,
} from "../lib/conversation.js";

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

    const conversationId = parsed.lead.conversationId || null;
    const latestInConversation = conversationId
      ? await findEventByConversationId(conversationId)
      : null;
    const priorThread = latestInConversation
      ? conversationFromEvent(latestInConversation)
      : [];
    const mergedConversation = enrichDisplayThread({
      conversation: mergeConversationHistory(priorThread, parsed.lead.conversation),
      yourMessage: parsed.lead.yourMessage,
      replyMessage: parsed.lead.replyMessage,
      sentReply:
        latestInConversation?.status === "sent"
          ? latestInConversation.sendResult?.reply || ""
          : "",
    });
    const leadWithHistory = {
      ...parsed.lead,
      conversation: mergedConversation,
    };

    const sentiment = await classifyReplySentiment({
      replyMessage: leadWithHistory.replyMessage,
      yourMessage: leadWithHistory.yourMessage,
      leadName: leadWithHistory.fullName,
      companyName: leadWithHistory.companyName,
    });

    let draftProjectId = "all";
    let project = { id: null, name: "All projects", source: "auto" };
    let draft = emptyDraft({ skipped: !isDraftGenerationEnabled() });

    if (isDraftGenerationEnabled()) {
      try {
        const result = await generateDraftForLead({
          lead: leadWithHistory,
          sentiment,
        });
        draft = result.draft;
        draftProjectId = result.draftProjectId;
        project = result.project;
      } catch (err) {
        draft = emptyDraft({ error: err.message });
      }
    }

    const eventPatch = {
      lead: leadWithHistory,
      linkedInAccount: leadWithHistory.linkedInAccountId
        ? {
            linkedInAccountId: leadWithHistory.linkedInAccountId,
            name: leadWithHistory.linkedInAccountName || null,
          }
        : null,
      campaign:
        leadWithHistory.campaignId || leadWithHistory.campaignName
          ? {
              id: leadWithHistory.campaignId ?? null,
              name: leadWithHistory.campaignName || null,
            }
          : null,
      messageType: leadWithHistory.messageType || leadWithHistory.eventType || null,
      sentiment: {
        label: sentiment.sentiment,
        isPositive: sentiment.isPositive,
        reasoning: sentiment.reasoning,
      },
      draftProjectId,
      project,
      draft,
      status: "pending_review",
    };

    const existing = conversationId
      ? await findEventByConversationId(conversationId, { status: "pending_review" })
      : null;

    // Idempotency guard: skip creating/rewriting when HeyReach resends
    // the same reply text for the same conversation.
    if (
      existing &&
      existing.lead?.replyMessage?.trim() &&
      leadWithHistory.replyMessage?.trim() &&
      existing.lead.replyMessage.trim() === leadWithHistory.replyMessage.trim()
    ) {
      return jsonResponse(res, 200, {
        ok: true,
        action: "duplicate_ignored",
        eventId: existing.id,
        sentiment: sentiment.sentiment,
        draftEnabled: isDraftGenerationEnabled(),
        project: project.id ? { id: project.id, name: project.name } : null,
      });
    }

    const record = existing
      ? await updateEvent(existing.id, {
          ...eventPatch,
          refreshedAt: new Date().toISOString(),
        })
      : await saveEvent(eventPatch);

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
