import "./tools/rag.js";
// Google Calendar agent tools disabled — use SCHEDULING_MODE=calendly (default).
// import "./tools/calendar.js";
// import { invokeTool } from "./tools.js";
import { generateDraftReply } from "../reply.js";
import { listProjects, selectProject } from "../projects.js";
import { buildConversationContext } from "../lead-context.js";
import { isCalendlySchedulingMode } from "../scheduling/config.js";
import { buildCalendlyScheduling } from "../scheduling/calendly.js";
// import {
//   parseSchedulingIntent,
//   matchLeadReplyToProposedSlot,
//   buildPendingBook,
// } from "../scheduling/intent.js";
// import { getGoogleCalendarConfig } from "../calendar/config.js";
// import { isGoogleCalendarConnected } from "../calendar/store.js";

// const MAX_AGENT_STEPS = 4;

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
  lead: _lead,
  priorProposedSlots: _priorProposedSlots,
  campaignName: _campaignName,
  linkedInUrl: _linkedInUrl,
  conversationId: _conversationId,
  agentTrace: _agentTrace,
}) {
  if (isCalendlySchedulingMode()) {
    return buildCalendlyScheduling();
  }

  // Google Calendar scheduling disabled — restore api/auth/google.js + SCHEDULING_MODE=gcal.
  return buildCalendlyScheduling();

  /*
  const config = getGoogleCalendarConfig();
  const connected = await isGoogleCalendarConnected();
  ... gcal agent tool flow ...
  */
}
