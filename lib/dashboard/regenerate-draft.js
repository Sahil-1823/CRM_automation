import { jsonResponse } from "../http.js";
import { getEvent, updateEvent, serializeEvent } from "../store.js";
import { generateDraftForLead } from "../draft-pipeline.js";
import { requireAuth } from "../auth.js";
import { syncHeyReachConversationByEventId } from "./sync-conversation-core.js";
import { classifyReply } from "../sentiment.js";
import { latestLeadMessage } from "../conversation/index.js";
import { log } from "../infra.js";

/**
 * Manual override: sync latest conversation (HeyReach), then always generate a draft
 * using that context — even if the last message is from us.
 * Reopens the event as pending_review so Send/Save are available.
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

    // Sync latest thread before drafting (HeyReach only; no-op-ish for Gmail)
    try {
      const syncResult = await syncHeyReachConversationByEventId(id);
      if (syncResult?.event) event = syncResult.event;
    } catch (syncErr) {
      log("warn", "regenerate.sync_failed", { eventId: id, error: syncErr.message });
      // Continue with stored conversation — manual override should still work
    }

    const lead = event.lead || {};
    const conversation = lead.conversation || [];
    const replyMessage =
      latestLeadMessage(conversation) || lead.replyMessage || "";

    // Fresh triage from latest context so scheduling / sentiment stay accurate
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

    const updated = await updateEvent(id, {
      status: "pending_review",
      autoResolvedAt: null,
      autoResolvedReason: null,
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
    });

    return jsonResponse(res, 200, { ok: true, event: serializeEvent(updated) });
  } catch (error) {
    console.error("regenerate-draft error:", error);
    return jsonResponse(res, 500, { error: "Failed to regenerate draft" });
  }
}
