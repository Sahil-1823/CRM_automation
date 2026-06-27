import "./tools/rag.js";
import { generateDraftReply } from "../reply.js";
import { listProjects, selectProject } from "../projects.js";
import { buildConversationContext } from "../lead-context.js";
import { isCalendlySchedulingMode } from "../scheduling/config.js";
import { buildCalendlyScheduling } from "../scheduling/calendly.js";

function isSchedulingTriage(triage) {
  return triage?.category === "scheduling" || !!triage?.schedulingIntent;
}

export async function runDraftAgent({
  lead,
  triage,
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
    if (isCalendlySchedulingMode()) {
      scheduling = buildCalendlyScheduling();
      agentTrace.push({ tool: "calendly", result: { mode: "calendly", link: scheduling.calendlyLink } });
    }
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
    agentContext: { scheduling, agentTrace, triageCategory: triage.category },
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
