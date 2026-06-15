import { parseHeyReachPayload, verifyHeyReachSecret } from "../lib/heyreach.js";
import { readJsonBody, jsonResponse } from "../lib/http.js";
import { classifyReplySentiment } from "../lib/sentiment.js";
import { generateDraftReply } from "../lib/reply.js";
import { saveEvent } from "../lib/store.js";
import { getConfig } from "../lib/config.js";
import { listProjects, selectProject } from "../lib/projects.js";
import { resolveLinkedInAccount } from "../lib/accounts.js";

function buildConversationContext(lead) {
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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return jsonResponse(res, 405, { error: "Method not allowed" });
  }

  try {
    const config = getConfig();

    if (!verifyHeyReachSecret(req, config.heyreach.webhookSecret)) {
      return jsonResponse(res, 401, { error: "Unauthorized" });
    }

    const payload = await readJsonBody(req);
    const parsed = parseHeyReachPayload(payload);

    if (!parsed.valid) {
      return jsonResponse(res, 400, {
        error: "Invalid HeyReach payload",
        missing: parsed.errors,
      });
    }

    const sentiment = await classifyReplySentiment({
      replyMessage: parsed.lead.replyMessage,
      yourMessage: parsed.lead.yourMessage,
      leadName: parsed.lead.fullName,
      companyName: parsed.lead.companyName,
    });

    // Auto-select the best matching project using LLM classification
    const projects = await listProjects();
    let selectedProject = null;
    if (projects.length) {
      const ctx = buildConversationContext(parsed.lead);
      selectedProject = await selectProject(ctx, projects);
    }

    let draft = null;
    let draftError = null;
    try {
      draft = await generateDraftReply({
        replyMessage: parsed.lead.replyMessage,
        yourMessage: parsed.lead.yourMessage,
        leadName: parsed.lead.fullName,
        companyName: parsed.lead.companyName,
        jobTitle: parsed.lead.jobTitle,
        sentiment: sentiment.sentiment,
        isPositive: sentiment.isPositive,
        conversation: parsed.lead.conversation,
        project: selectedProject,
        projectScope: selectedProject ? "project" : "all",
      });
    } catch (err) {
      draftError = err.message;
    }

    const draftProjectId = selectedProject ? selectedProject.id : "all";
    const linkedInAccount = await resolveLinkedInAccount(parsed.lead.linkedInAccountId);

    const record = await saveEvent({
      lead: parsed.lead,
      linkedInAccount,
      sentiment: {
        label: sentiment.sentiment,
        isPositive: sentiment.isPositive,
        reasoning: sentiment.reasoning,
      },
      draftProjectId,
      project: selectedProject
        ? { id: selectedProject.id, name: selectedProject.name, source: "auto" }
        : { id: null, name: "All projects", source: "auto" },
      draft: draft
        ? {
            reply: draft.reply,
            rationale: draft.rationale,
            ragSources: draft.ragSources,
            citedSources: draft.citedSources,
            hasGrounding: draft.hasGrounding,
            error: null,
          }
        : {
            reply: "",
            rationale: "",
            ragSources: [],
            citedSources: [],
            hasGrounding: false,
            error: draftError,
          },
      status: "pending_review",
    });

    return jsonResponse(res, 200, {
      ok: true,
      action: "pending_review",
      eventId: record.id,
      sentiment: sentiment.sentiment,
      project: selectedProject
        ? { id: selectedProject.id, name: selectedProject.name }
        : null,
    });
  } catch (error) {
    console.error("heyreach-webhook error:", error);
    return jsonResponse(res, 500, {
      error: "Internal server error",
      message: error.message,
    });
  }
}
