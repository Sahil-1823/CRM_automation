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
  conversationFromEvent,
  mergeWebhookConversation,
  evaluateInboundWebhook,
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

    const mergedConversation = mergeWebhookConversation({
      priorEvent: latestInConversation,
      priorThread,
      incomingThread: parsed.lead.conversation,
      yourMessage: parsed.lead.yourMessage,
      replyMessage: parsed.lead.replyMessage,
    });

    const inbound = evaluateInboundWebhook({
      priorEvent: latestInConversation,
      priorThread,
      mergedConversation,
      incomingReplyMessage: parsed.lead.replyMessage,
    });

    if (!inbound.process) {
      return jsonResponse(res, 200, {
        ok: true,
        action: "skipped",
        reason: inbound.reason,
        eventId: latestInConversation?.id || null,
      });
    }

    const leadWithHistory = {
      ...parsed.lead,
      conversation: mergedConversation,
      replyMessage: inbound.latestLeadReply,
    };

    const existing = conversationId
      ? await findEventByConversationId(conversationId, { status: "pending_review" })
      : null;

    if (
      existing &&
      existing.lead?.replyMessage?.trim() === leadWithHistory.replyMessage?.trim()
    ) {
      return jsonResponse(res, 200, {
        ok: true,
        action: "duplicate_ignored",
        eventId: existing.id,
      });
    }

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
