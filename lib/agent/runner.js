import "./tools/rag.js";
import "./tools/calendar.js";
import { invokeTool } from "./tools.js";
import { generateDraftReply } from "../reply.js";
import { listProjects, selectProject } from "../projects.js";
import { buildConversationContext } from "../lead-context.js";
import {
  parseSchedulingIntent,
  matchLeadReplyToProposedSlot,
  buildPendingBook,
} from "../scheduling/intent.js";
import { getGoogleCalendarConfig } from "../calendar/config.js";
import { isGoogleCalendarConnected } from "../calendar/store.js";
import { isCalendlySchedulingMode } from "../scheduling/config.js";
import { buildCalendlyScheduling } from "../scheduling/calendly.js";

const MAX_AGENT_STEPS = 4;

function isSchedulingTriage(triage) {
  return triage?.category === "scheduling" || !!triage?.schedulingIntent;
}

/**
 * Lightweight agent: deterministic calendar tools + RAG-backed draft generation.
 */
export async function runDraftAgent({
  lead,
  triage,
  priorProposedSlots = [],
  campaignName = null,
  linkedInUrl = null,
  conversationId = null,
  projectOverride,
  projectScopeOverride = null,
}) {
  const agentTrace = [];
  let scheduling = null;

  const projects = await listProjects();
  let selectedProject = null;
  if (projectOverride !== undefined) {
    selectedProject = projectOverride;
  } else if (projectScopeOverride !== "none" && projects.length) {
    const ctx = buildConversationContext(lead);
    selectedProject = await selectProject(ctx, projects);
  }

  const projectScope =
    projectScopeOverride ?? (selectedProject ? "project" : "all");

  if (isSchedulingTriage(triage)) {
    scheduling = await resolveScheduling({
      lead,
      priorProposedSlots,
      campaignName,
      linkedInUrl,
      conversationId,
      agentTrace,
    });
  }

  const draft = await generateDraftReply({
    replyMessage: lead.replyMessage,
    yourMessage: lead.yourMessage,
    leadName: lead.fullName,
    companyName: lead.companyName,
    jobTitle: lead.jobTitle,
    sentiment: triage.sentiment,
    isPositive: triage.isPositive,
    conversation: lead.conversation,
    project: selectedProject,
    projectScope: projectScope === "none" ? "none" : projectScope,
    agentContext: {
      scheduling,
      agentTrace,
      triageCategory: triage.category,
    },
  });

  return {
    draft,
    scheduling,
    agentTrace,
    draftProjectId:
      projectScope === "none"
        ? "none"
        : selectedProject
          ? selectedProject.id
          : "all",
    project:
      projectScope === "none"
        ? { id: null, name: "None", source: "auto" }
        : selectedProject
          ? { id: selectedProject.id, name: selectedProject.name, source: "auto" }
          : { id: null, name: "All projects", source: "auto" },
  };
}

async function resolveScheduling({
  lead,
  priorProposedSlots,
  campaignName,
  linkedInUrl,
  conversationId,
  agentTrace,
}) {
  if (isCalendlySchedulingMode()) {
    return buildCalendlyScheduling();
  }

  const config = getGoogleCalendarConfig();
  const connected = await isGoogleCalendarConnected();

  let intent;
  try {
    intent = await parseSchedulingIntent({
      replyMessage: lead.replyMessage,
      conversation: lead.conversation,
      priorProposedSlots,
    });
  } catch (err) {
    return {
      intent: true,
      requestedTime: null,
      status: "error",
      proposedSlots: [],
      pendingBook: null,
      calendarEventId: null,
      calendarError: err.message,
    };
  }

  if (!intent.wantsMeeting && !intent.confirmsPriorSlot && priorProposedSlots.length === 0) {
    return null;
  }

  if (!connected) {
    return {
      intent: true,
      requestedTime: intent.preferredStart,
      status: "calendar_disconnected",
      proposedSlots: [],
      pendingBook: null,
      calendarEventId: null,
      calendarError: "Google Calendar not connected",
    };
  }

  let matchedSlot = matchLeadReplyToProposedSlot(lead.replyMessage, priorProposedSlots);
  if (!matchedSlot && intent.preferredStart && priorProposedSlots.length) {
    matchedSlot = priorProposedSlots.find((s) => s.start === intent.preferredStart) || null;
  }

  const durationMin = intent.durationMinutes || config.defaultDurationMin;

  if (matchedSlot || intent.preferredStart) {
    const start = matchedSlot ? matchedSlot.start : intent.preferredStart;
    const end = matchedSlot
      ? matchedSlot.end
      : new Date(new Date(start).getTime() + durationMin * 60_000).toISOString();

    if (agentTrace.length < MAX_AGENT_STEPS) {
      const avail = await invokeTool("checkAvailability", { start, end });
      agentTrace.push({ tool: "checkAvailability", args: { start, end }, result: avail });

      if (avail.available) {
        return {
          intent: true,
          requestedTime: start,
          status: "ready_to_book",
          proposedSlots: [],
          pendingBook: buildPendingBook({
            start,
            end,
            leadName: lead.fullName,
            companyName: lead.companyName,
            campaignName,
            linkedInUrl,
            conversationId,
            conversation: lead.conversation,
          }),
          calendarEventId: null,
          calendarError: null,
        };
      }

      if (agentTrace.length < MAX_AGENT_STEPS) {
        const slotsResult = await invokeTool("findOpenSlots", { durationMin, maxSlots: 3 });
        agentTrace.push({ tool: "findOpenSlots", result: slotsResult });
        return {
          intent: true,
          requestedTime: start,
          status: "suggest_alternatives",
          proposedSlots: slotsResult.slots || [],
          pendingBook: null,
          calendarEventId: null,
          calendarError: null,
        };
      }
    }
  }

  if (intent.wantsMeeting && agentTrace.length < MAX_AGENT_STEPS) {
    const slotsResult = await invokeTool("findOpenSlots", { durationMin, maxSlots: 3 });
    agentTrace.push({ tool: "findOpenSlots", result: slotsResult });
    return {
      intent: true,
      requestedTime: intent.preferredStart,
      status: intent.preferredStart ? "awaiting_confirmation" : "suggest_alternatives",
      proposedSlots: slotsResult.slots || [],
      pendingBook: null,
      calendarEventId: null,
      calendarError: null,
    };
  }

  return {
    intent: true,
    requestedTime: intent.preferredStart,
    status: "awaiting_confirmation",
    proposedSlots: [],
    pendingBook: null,
    calendarEventId: null,
    calendarError: null,
  };
}
