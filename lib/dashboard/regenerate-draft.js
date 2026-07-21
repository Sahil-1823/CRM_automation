import { jsonResponse } from "../http.js";
import { getEvent, updateEvent, serializeEvent } from "../store.js";
import { generateDraftForLead } from "../draft-pipeline.js";
import { requireAuth } from "../auth.js";
import { syncHeyReachConversationByEventId } from "./sync-conversation-core.js";
import { classifyReply } from "../sentiment.js";
import {
  latestLeadMessage,
  resolveStatusFromConversation,
} from "../conversation/index.js";
import { log } from "../infra.js";

/**
 * Manual override: sync latest conversation, then always generate a draft.
 * Status follows thread: pending_review only when last message is from the lead.
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return jsonResponse(res, 405, { error: "Method not allowed" });
  }

  try {
    if (!(await requireAuth(req, res))) return;

    const url = new URL(req.url, "http://localhost");
    const id = url.searchParams.get("id");
    if (!id) return jsonResponse(res, 400, { error: "Missing ?id=" });

    let event = await getEvent(id);
    if (!event) return jsonResponse(res, 404, { error: "Event not found" });

    const channel = event.channel === "gmail" ? "gmail" : "heyreach";

    try {
      const syncResult = await syncHeyReachConversationByEventId(id);
      if (syncResult?.event) event = syncResult.event;
    } catch (syncErr) {
      log("warn", "regenerate.sync_failed", { eventId: id, error: syncErr.message });
    }

    const lead = event.lead || {};
    const conversation = lead.conversation || [];
    const replyMessage =
      latestLeadMessage(conversation) || lead.replyMessage || "";
    const status = resolveStatusFromConversation(conversation, event.status);

    let triage = {
      sentiment: event.sentiment?.label || "neutral",
      isPositive: event.sentiment?.isPositive,
      category: event.handling?.category || "conversational",
      schedulingIntent: event.handling?.category === "scheduling",
      requiresHuman: event.handling?.requiresHuman,
      actionItems: event.handling?.actionItems || [],
      handlingReason: event.handling?.reason || "",
      reasoning: event.sentiment?.reasoning || "",
    };

    if (replyMessage.trim()) {
      try {
        triage = await classifyReply({
          replyMessage,
          yourMessage: lead.yourMessage,
          leadName: lead.fullName,
          companyName: lead.companyName,
          conversation,
        });
      } catch (triageErr) {
        log("warn", "regenerate.triage_failed", { eventId: id, error: triageErr.message });
      }
    }

    const priorProposedSlots = event.draft?.scheduling?.proposedSlots || [];

    const finalized = await generateDraftForLead({
      lead: {
        ...lead,
        conversation,
        replyMessage: replyMessage || lead.replyMessage,
      },
      sentiment: triage,
      priorProposedSlots,
      campaignName: event.campaign?.name || lead.campaignName,
      linkedInUrl: lead.linkedInUrl || null,
      conversationId: lead.conversationId || null,
      channel,
    });

    const patch = {
      status,
      draftProjectId: finalized.draftProjectId,
      project: finalized.project,
      draft: finalized.draft,
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
      lead: {
        ...lead,
        conversation,
        replyMessage: replyMessage || lead.replyMessage,
      },
    };

    if (status === "pending_review") {
      patch.autoResolvedAt = null;
      patch.autoResolvedReason = null;
    }

    const updated = await updateEvent(id, patch);

    return jsonResponse(res, 200, { ok: true, event: serializeEvent(updated) });
  } catch (error) {
    console.error("regenerate-draft error:", error);
    return jsonResponse(res, 500, { error: "Failed to regenerate draft" });
  }
}
