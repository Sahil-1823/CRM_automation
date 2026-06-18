import { parseHeyReachPayload, verifyHeyReachSecret } from "../lib/heyreach.js";
import { readJsonBody, jsonResponse } from "../lib/http.js";
import { classifyReplySentiment } from "../lib/sentiment.js";
import {
  isDraftGenerationEnabled,
  generateDraftForLead,
  emptyDraft,
} from "../lib/draft-pipeline.js";
import {
  saveEvent,
  findEventByConversationId,
  findAllEventsByConversationId,
  updateEvent,
} from "../lib/store.js";
import { getConfig } from "../lib/config.js";
import {
  conversationFromEvent,
  mergeWebhookConversation,
  evaluateInboundWebhook,
  syncAllLeadConversationEvents,
} from "../lib/conversation.js";
import { fetchEnrichedIncomingThread } from "../lib/conversation-sync.js";
import {
  log,
  buildIdempotencyKey,
  claimIdempotencyKey,
  archiveRawWebhook,
} from "../lib/infra.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return jsonResponse(res, 405, { error: "Method not allowed" });
  }

  const startedAt = Date.now();

  try {
    const config = getConfig();

    if (!verifyHeyReachSecret(req, config.heyreach.webhookSecret)) {
      log("warn", "webhook.unauthorized");
      return jsonResponse(res, 401, { error: "Unauthorized" });
    }

    const payload = await readJsonBody(req);
    const rawId = await archiveRawWebhook(payload, {
      ua: req.headers["user-agent"] || null,
    });

    const parsed = parseHeyReachPayload(payload);
    if (!parsed.valid) {
      log("warn", "webhook.invalid_payload", { rawId, missing: parsed.errors });
      return jsonResponse(res, 400, {
        error: "Invalid HeyReach payload",
        missing: parsed.errors,
      });
    }

    const conversationId = parsed.lead.conversationId || null;
    const linkedInAccountId = parsed.lead.linkedInAccountId || null;
    const eventType = parsed.lead.eventType || parsed.lead.messageType || null;

    // Always refresh from HeyReach inbox API (cached 60s) so outbound replies
    // sent directly in HeyReach appear in the admin chat.
    const incomingThread = await fetchEnrichedIncomingThread({
      conversationId,
      linkedInAccountId,
      webhookThread: parsed.lead.conversation,
    });

    const latestInConversation = conversationId
      ? await findEventByConversationId(conversationId)
      : null;
    const priorThread = latestInConversation
      ? conversationFromEvent(latestInConversation)
      : [];

    const mergedConversation = mergeWebhookConversation({
      priorEvent: latestInConversation,
      priorThread,
      incomingThread,
      yourMessage: parsed.lead.yourMessage,
      replyMessage: parsed.lead.replyMessage,
    });

    const conversationSync = conversationId
      ? await syncAllLeadConversationEvents({
          conversationId,
          mergedConversation,
          parsedLead: parsed.lead,
          findAllEvents: findAllEventsByConversationId,
          updateEvent,
        })
      : { synced: 0, primaryId: null };

    const idemKey = buildIdempotencyKey({
      conversationId,
      eventType,
      latestText: parsed.lead.replyMessage,
      fallbackBody: rawId,
    });
    const firstSeen = await claimIdempotencyKey(idemKey);
    if (!firstSeen) {
      log("info", "webhook.duplicate_delivery", {
        rawId,
        idemKey,
        conversationId,
        synced: conversationSync.synced,
      });
      return jsonResponse(res, 200, {
        ok: true,
        action: "duplicate_delivery",
        conversationSynced: conversationSync.synced > 0,
        eventsUpdated: conversationSync.synced,
        rawId,
      });
    }

    const inbound = evaluateInboundWebhook({
      priorEvent: latestInConversation,
      priorThread,
      mergedConversation,
      incomingReplyMessage: parsed.lead.replyMessage,
    });

    if (!inbound.process) {
      log("info", "webhook.skipped", {
        rawId,
        conversationId,
        reason: inbound.reason,
        synced: conversationSync.synced,
        ms: Date.now() - startedAt,
      });
      return jsonResponse(res, 200, {
        ok: true,
        action: "skipped",
        reason: inbound.reason,
        conversationSynced: conversationSync.synced > 0,
        eventsUpdated: conversationSync.synced,
        eventId: conversationSync.primaryId || latestInConversation?.id || null,
        rawId,
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
      log("info", "webhook.duplicate_pending", {
        rawId,
        conversationId,
        eventId: existing.id,
      });
      return jsonResponse(res, 200, {
        ok: true,
        action: "duplicate_ignored",
        conversationSynced: conversationSync.synced > 0,
        eventsUpdated: conversationSync.synced,
        eventId: existing.id,
        rawId,
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
        log("warn", "draft.generation_failed", { conversationId, error: err.message });
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

    if (conversationId && !existing && latestInConversation) {
      await syncAllLeadConversationEvents({
        conversationId,
        mergedConversation,
        parsedLead: parsed.lead,
        findAllEvents: findAllEventsByConversationId,
        updateEvent,
      });
    }

    log("info", "webhook.pending_review", {
      rawId,
      conversationId,
      eventId: record.id,
      synced: conversationSync.synced,
      sentiment: sentiment.sentiment,
      ms: Date.now() - startedAt,
    });

    return jsonResponse(res, 200, {
      ok: true,
      action: "pending_review",
      eventId: record.id,
      conversationSynced: conversationSync.synced > 0,
      eventsUpdated: conversationSync.synced,
      sentiment: sentiment.sentiment,
      draftEnabled: isDraftGenerationEnabled(),
      project: project.id ? { id: project.id, name: project.name } : null,
      rawId,
    });
  } catch (error) {
    log("error", "webhook.error", {
      error: error.message,
      stack: error.stack,
      ms: Date.now() - startedAt,
    });
    return jsonResponse(res, 500, {
      error: "Internal server error",
      message: error.message,
    });
  }
}
