import { jsonResponse, readJsonBody } from "../lib/http.js";
import { getEvent, updateEvent } from "../lib/store.js";
import { generateDraftReply } from "../lib/reply.js";
import { getProject } from "../lib/projects.js";
import { requireAuth } from "../lib/auth.js";

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

    const body = await readJsonBody(req);
    // "all" = search all projects; specific id = that project + global docs
    const projectId = body.projectId === undefined ? event.draftProjectId ?? "all" : body.projectId;

    let project = null;
    if (projectId && projectId !== "all") {
      project = await getProject(projectId);
      if (!project) {
        return jsonResponse(res, 400, { error: `Project not found: ${projectId}` });
      }
    }

    const lead = event.lead || {};
    const sentiment = event.sentiment || {};

    const draft = await generateDraftReply({
      replyMessage: lead.replyMessage,
      yourMessage: lead.yourMessage,
      leadName: lead.fullName,
      companyName: lead.companyName,
      jobTitle: lead.jobTitle,
      sentiment: sentiment.label,
      isPositive: sentiment.isPositive,
      conversation: lead.conversation,
      project,
      projectScope: projectId === "all" || !projectId ? "all" : "project",
    });

    const updated = await updateEvent(id, {
      draftProjectId: projectId === "all" || !projectId ? "all" : projectId,
      project: project
        ? { id: project.id, name: project.name, source: "manual" }
        : { id: null, name: "All projects", source: "manual" },
      draft: {
        reply: draft.reply,
        rationale: draft.rationale,
        ragSources: draft.ragSources,
        citedSources: draft.citedSources,
        hasGrounding: draft.hasGrounding,
        error: null,
      },
    });

    return jsonResponse(res, 200, { ok: true, event: updated });
  } catch (error) {
    console.error("regenerate-draft error:", error);
    return jsonResponse(res, 500, {
      error: "Failed to regenerate draft",
      message: error.message,
    });
  }
}
