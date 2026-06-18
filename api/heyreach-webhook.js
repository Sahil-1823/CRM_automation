import { parseHeyReachPayload, verifyHeyReachSecret } from "../lib/heyreach.js";
import { readJsonBody, jsonResponse } from "../lib/http.js";
import { classifyReply } from "../lib/sentiment.js";
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
  buildEnsuredConversationEvent,
  isAwaitingLeadReply,
  latestLeadMessage,
} from "../lib/conversation.js";
import { fetchEnrichedIncomingThread } from "../lib/conversation-sync.js";
import {
  log,
  buildIdempotencyKey,
  claimIdempotencyKey,
  archiveRawWebhook,
} from "../lib/infra.js";

async function ensureFirstConversationVisible({
  conversationId,
  mergedConversation,
  parsedLead,
  inbound,
}) {
  if (!conversationId || !mergedConversation?.some((m) => m.from === "lead")) {
    return null;
  }

  const existing = await findAllEventsByConversationId(conversationId);
  if (existing.length > 0) return existing[0];

  if (isAwaitingLeadReply(mergedConversation)) {
    return {
      forceProcess: true,
      latestLeadReply:
        latestLeadMessage(mergedConversation) || parsedLead.replyMessage || inbound?.latestLeadReply || "",
    };
  }

  const patch = buildEnsuredConversationEvent({ mergedConversation, parsedLead, inbound });
  if (!patch) return null;

  const record = await saveEvent(patch);
  log("info", "webhook.ensured_visible", {
    conversationId,
    eventId: record.id,
    status: record.status,
  });
  return record;
}

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

    let inbound = evaluateInboundWebhook({
      priorEvent: latestInConversation,
      priorThread,
      mergedConversation,
      incomingReplyMessage: parsed.lead.replyMessage,
    });

    const idemKey = buildIdempotencyKey({
      conversationId,
      eventType,
      latestText: parsed.lead.replyMessage,
      fallbackBody: rawId,
    });
    const firstSeen = await claimIdempotencyKey(idemKey);
    if (!firstSeen) {
      const ensured = await ensureFirstConversationVisible({
        conversationId,
        mergedConversation,
        parsedLead: parsed.lead,
        inbound,
      });

      log("info", "webhook.duplicate_delivery", {
        rawId,
        idemKey,
        conversationId,
        synced: conversationSync.synced,
        ensuredEventId: ensured?.id || null,
      });
      return jsonResponse(res, 200, {
        ok: true,
        action: "duplicate_delivery",
        conversationSynced: conversationSync.synced > 0,
        eventsUpdated: conversationSync.synced,
        eventId: ensured?.id || conversationSync.primaryId || latestInConversation?.id || null,
        rawId,
      });
    }

    if (!inbound.process) {
      const ensured = await ensureFirstConversationVisible({
        conversationId,
        mergedConversation,
        parsedLead: parsed.lead,
        inbound,
      });

      // If we've already replied (in HeyReach or via dashboard) and a pending
      // event still has a stale draft, auto-resolve it so the operator stops
      // seeing a "Send via HeyReach" button for a reply they already handled.
      let autoResolvedId = null;
      if (
        conversationId &&
        inbound.reason === "already_replied" &&
        !ensured?.forceProcess
      ) {
        const staleP = await findEventByConversationId(conversationId, {
          status: "pending_review",
        });
        if (staleP) {
          await updateEvent(staleP.id, {
            status: "auto_resolved",
            autoResolvedAt: new Date().toISOString(),
            autoResolvedReason: "Reply already exists in HeyReach thread",
            draft: emptyDraft({ skipped: true }),
          });
          autoResolvedId = staleP.id;
          log("info", "webhook.auto_resolved", {
            rawId,
            conversationId,
            eventId: staleP.id,
          });
        }
      }

      if (ensured?.forceProcess) {
        inbound = {
          process: true,
          reason: "first_conversation",
          latestLeadReply: ensured.latestLeadReply,
        };
      } else if (ensured?.id || autoResolvedId) {
        log("info", "webhook.synced_only", {
          rawId,
          conversationId,
          eventId: ensured?.id || autoResolvedId,
          reason: inbound.reason,
          autoResolved: !!autoResolvedId,
          ms: Date.now() - startedAt,
        });
        return jsonResponse(res, 200, {
          ok: true,
          action: autoResolvedId ? "auto_resolved" : "synced_only",
          reason: inbound.reason,
          eventId: ensured?.id || autoResolvedId,
          conversationSynced: conversationSync.synced > 0,
          eventsUpdated: conversationSync.synced,
          rawId,
        });
      }
    }

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

    const triage = await classifyReply({
      replyMessage: leadWithHistory.replyMessage,
      yourMessage: leadWithHistory.yourMessage,
      leadName: leadWithHistory.fullName,
      companyName: leadWithHistory.companyName,
      conversation: leadWithHistory.conversation,
    });

    let draftProjectId = "all";
    let project = { id: null, name: "All projects", source: "auto" };
    let draft = emptyDraft({ skipped: !isDraftGenerationEnabled() });

    if (triage.requiresHuman) {
      draft = emptyDraft({ skipped: true });
      log("info", "webhook.needs_human", {
        rawId,
        conversationId,
        category: triage.category,
        actionItems: triage.actionItems,
        reason: triage.handlingReason,
      });
    } else if (isDraftGenerationEnabled()) {
      try {
        const result = await generateDraftForLead({
          lead: leadWithHistory,
          sentiment: triage,
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
        label: triage.sentiment,
        isPositive: triage.isPositive,
        reasoning: triage.reasoning,
      },
      handling: {
        requiresHuman: triage.requiresHuman,
        category: triage.category,
        actionItems: triage.actionItems,
        reason: triage.handlingReason,
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
      sentiment: triage.sentiment,
      requiresHuman: triage.requiresHuman,
      category: triage.category,
      ms: Date.now() - startedAt,
    });

    return jsonResponse(res, 200, {
      ok: true,
      action: "pending_review",
      eventId: record.id,
      conversationSynced: conversationSync.synced > 0,
      eventsUpdated: conversationSync.synced,
      sentiment: triage.sentiment,
      requiresHuman: triage.requiresHuman,
      category: triage.category,
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
    return jsonResponse(res, 500, { error: "Internal server error" });
  }
}
