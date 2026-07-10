import { runDraftAgent } from "./agent/runner.js";
import { HANDLING_CATEGORIES } from "./sentiment.js";
import { buildConversationContext } from "./lead-context.js";
import { appendCalendlyLinkToReply } from "./scheduling/calendly.js";
import { appendBookingLinkToReply } from "./scheduling/booking-link.js";
import { getDraftProjectBindingForChannel } from "./channel-project-settings.js";

export { HANDLING_CATEGORIES, buildConversationContext };

export function isDraftGenerationEnabled() {
  return process.env.DRAFT_GENERATION_ENABLED === "true";
}

export function isGmailAutoSendEnabled() {
  return process.env.GMAIL_AUTO_SEND_ENABLED === "true";
}

export function emptyDraft({ error = null, skipped = false } = {}) {
  return {
    reply: "",
    rationale: "",
    ragSources: [],
    citedSources: [],
    hasGrounding: false,
    scheduling: null,
    agentTrace: [],
    error,
    skipped,
  };
}

export function draftFromGeneration(draft, { scheduling = null, agentTrace = null } = {}) {
  return {
    reply: draft.reply,
    rationale: draft.rationale,
    ragSources: draft.ragSources,
    citedSources: draft.citedSources,
    hasGrounding: draft.hasGrounding,
    scheduling: scheduling || null,
    agentTrace: agentTrace || [],
    error: null,
    skipped: false,
  };
}

export function finalizeAgentDraftResult(result, { channel = null } = {}) {
  let reply = result.draft.reply;
  const scheduling = result.scheduling;

  if (scheduling?.intent) {
    if (channel === "gmail" && scheduling.mode === "calendly") {
      reply = appendCalendlyLinkToReply(reply, scheduling.calendlyLink);
    } else if (channel === "heyreach" && scheduling.mode === "booking_link" && scheduling.bookingLink) {
      reply = appendBookingLinkToReply(reply, scheduling.bookingLink);
    }
  }

  return {
    draft: draftFromGeneration({ ...result.draft, reply }, {
      scheduling: result.scheduling,
      agentTrace: result.agentTrace,
    }),
    draftProjectId: result.draftProjectId,
    project: result.project,
  };
}

export function shouldAutoSend(event) {
  if (!event) return { allowed: false, reason: "No event" };
  if (event.handling?.requiresHuman) {
    return { allowed: false, reason: event.handling.reason || "Reply requires human action" };
  }
  const sentimentLabel = event.sentiment?.label ?? event.sentiment?.sentiment;
  if (sentimentLabel === "negative") {
    return { allowed: false, reason: "Negative sentiment — do not auto-send" };
  }
  const draft = event.draft || {};
  if (draft.skipped) return { allowed: false, reason: "Draft was skipped" };
  if (!draft.reply?.trim()) return { allowed: false, reason: "No draft reply text" };
  return { allowed: true, reason: "Safe for auto-send" };
}

export async function generateDraftForLead({
  lead,
  sentiment,
  priorProposedSlots = [],
  campaignName = null,
  linkedInUrl = null,
  conversationId = null,
  channel = null,
  projectOverride,
  projectScopeOverride,
}) {
  let binding = null;
  if (channel) {
    binding = await getDraftProjectBindingForChannel(channel);
  } else if (projectOverride !== undefined || projectScopeOverride !== undefined) {
    binding = { projectOverride, projectScopeOverride };
  }

  const result = await runDraftAgent({
    lead,
    triage: sentiment,
    priorProposedSlots,
    campaignName,
    linkedInUrl,
    conversationId,
    channel,
    ...(binding || {}),
  });

  const finalized = finalizeAgentDraftResult(result, { channel });
  if (channel && binding?.draftProjectId) {
    return {
      ...finalized,
      draftProjectId: binding.draftProjectId,
      project: binding.project,
    };
  }
  return finalized;
}
