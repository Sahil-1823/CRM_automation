import { generateDraftReply } from "./reply.js";
import { listProjects, selectProject } from "./projects.js";

/** Set DRAFT_GENERATION_ENABLED=true to run OpenAI draft generation on incoming webhooks. */
export function isDraftGenerationEnabled() {
  return process.env.DRAFT_GENERATION_ENABLED === "true";
}

export function buildConversationContext(lead) {
  const parts = [];
  if (lead.fullName) parts.push(`Lead: ${lead.fullName}`);
  if (lead.companyName) parts.push(`Company: ${lead.companyName}`);
  if (lead.jobTitle) parts.push(`Title: ${lead.jobTitle}`);

  if (lead.conversation?.length) {
    parts.push(
      "Thread:\n" +
        lead.conversation
          .map((m) => `${m.from === "lead" ? "Lead" : "Us"}: ${m.text}`)
          .join("\n"),
    );
  } else {
    if (lead.yourMessage) parts.push(`Our message: ${lead.yourMessage}`);
    if (lead.replyMessage) parts.push(`Lead reply: ${lead.replyMessage}`);
  }

  return parts.join("\n");
}

export function emptyDraft({ error = null, skipped = false } = {}) {
  return {
    reply: "",
    rationale: "",
    ragSources: [],
    citedSources: [],
    hasGrounding: false,
    error,
    skipped,
  };
}

export function draftFromGeneration(draft) {
  return {
    reply: draft.reply,
    rationale: draft.rationale,
    ragSources: draft.ragSources,
    citedSources: draft.citedSources,
    hasGrounding: draft.hasGrounding,
    error: null,
    skipped: false,
  };
}

/** Full draft pipeline: project selection + RAG reply generation. */
export async function generateDraftForLead({ lead, sentiment }) {
  const projects = await listProjects();
  let selectedProject = null;
  if (projects.length) {
    const ctx = buildConversationContext(lead);
    selectedProject = await selectProject(ctx, projects);
  }

  const draft = await generateDraftReply({
    replyMessage: lead.replyMessage,
    yourMessage: lead.yourMessage,
    leadName: lead.fullName,
    companyName: lead.companyName,
    jobTitle: lead.jobTitle,
    sentiment: sentiment.sentiment,
    isPositive: sentiment.isPositive,
    conversation: lead.conversation,
    project: selectedProject,
    projectScope: selectedProject ? "project" : "all",
  });

  return {
    draft: draftFromGeneration(draft),
    draftProjectId: selectedProject ? selectedProject.id : "all",
    project: selectedProject
      ? { id: selectedProject.id, name: selectedProject.name, source: "auto" }
      : { id: null, name: "All projects", source: "auto" },
  };
}
