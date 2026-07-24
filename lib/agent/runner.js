import "./tools/rag.js";
import { generateDraftReply } from "../reply.js";
import { listProjects, selectProject } from "../projects.js";
import { buildConversationContext } from "../lead-context.js";
import { isCalendlySchedulingMode } from "../scheduling/config.js";
import { buildCalendlyScheduling } from "../scheduling/calendly.js";
import { buildHeyReachBookingScheduling } from "../scheduling/booking-link.js";

function isSchedulingTriage(triage) {
  return triage?.category === "scheduling" || !!triage?.schedulingIntent;
}

export async function runDraftAgent({
  lead,
  triage,
  priorProposedSlots = [],
  campaignName = null,
  linkedInUrl = null,
  conversationId = null,
  channel = null,
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
    selectedProject = await selectProject(ctx, projects, conversationId || null);
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
      channel,
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
      projectScope === "none" ? "none" : selectedProject ? selectedProject.id : "all",
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
  priorProposedSlots: _priorProposedSlots,
  campaignName: _campaignName,
  linkedInUrl: _linkedInUrl,
  conversationId: _conversationId,
  channel = null,
  agentTrace,
}) {
  const conversation = lead?.conversation || [];

  if (channel === "heyreach") {
    const scheduling = buildHeyReachBookingScheduling(undefined, { conversation });
    agentTrace.push({
      tool: "heyreach_booking_link",
      result: {
        mode: scheduling.mode,
        link: scheduling.bookingLink || null,
        configured: !!scheduling.bookingLink,
        alreadyOffered: !!scheduling.alreadyOffered,
        appendLink: !!scheduling.appendLink,
        waitingOnLead: !!scheduling.waitingOnLead,
      },
    });
    return scheduling;
  }

  if (channel === "gmail" || isCalendlySchedulingMode()) {
    const scheduling = buildCalendlyScheduling(undefined, { conversation });
    agentTrace.push({
      tool: "calendly",
      result: {
        mode: "calendly",
        link: scheduling.calendlyLink,
        alreadyOffered: !!scheduling.alreadyOffered,
        appendLink: !!scheduling.appendLink,
        waitingOnLead: !!scheduling.waitingOnLead,
      },
    });
    return scheduling;
  }

  return buildCalendlyScheduling(undefined, { conversation });
}
