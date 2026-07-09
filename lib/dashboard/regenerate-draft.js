import { jsonResponse } from "../http.js";
import { getEvent, updateEvent, serializeEvent } from "../store.js";
import { generateDraftForLead } from "../draft-pipeline.js";
import { requireAuth } from "../auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return jsonResponse(res, 405, { error: "Method not allowed" });
  }

  try {
    if (!(await requireAuth(req, res))) return;

    const url = new URL(req.url, "http://localhost");
    const id = url.searchParams.get("id");
    if (!id) return jsonResponse(res, 400, { error: "Missing ?id=" });

    const event = await getEvent(id);
    if (!event) return jsonResponse(res, 404, { error: "Event not found" });

    const channel = event.channel === "gmail" ? "gmail" : "heyreach";
    const lead = event.lead || {};
    const sentiment = event.sentiment || {};
    const triage = {
      sentiment: sentiment.label || "neutral",
      isPositive: sentiment.isPositive,
      category: event.handling?.category || "conversational",
      schedulingIntent: event.handling?.category === "scheduling",
    };

    const priorProposedSlots = event.draft?.scheduling?.proposedSlots || [];

    const finalized = await generateDraftForLead({
      lead,
      sentiment: triage,
      priorProposedSlots,
      campaignName: event.campaign?.name || lead.campaignName,
      linkedInUrl: lead.linkedInUrl || null,
      conversationId: lead.conversationId || null,
      channel,
    });

    const updated = await updateEvent(id, {
      draftProjectId: finalized.draftProjectId,
      project: finalized.project,
      draft: finalized.draft,
    });

    return jsonResponse(res, 200, { ok: true, event: serializeEvent(updated) });
  } catch (error) {
    console.error("regenerate-draft error:", error);
    return jsonResponse(res, 500, { error: "Failed to regenerate draft" });
  }
}
