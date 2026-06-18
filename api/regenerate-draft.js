import { jsonResponse, readJsonBody } from "../lib/http.js";
import { getEvent, updateEvent, serializeEvent } from "../lib/store.js";
import { generateDraftReply } from "../lib/reply.js";
import { draftFromGeneration } from "../lib/draft-pipeline.js";
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
    let projectScope = "all";
    if (projectId === "none") {
      projectScope = "none";
    } else if (projectId && projectId !== "all") {
      project = await getProject(projectId);
      if (!project) {
        return jsonResponse(res, 400, { error: `Project not found: ${projectId}` });
      }
      projectScope = "project";
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
      projectScope,
    });

    const updated = await updateEvent(id, {
      draftProjectId:
        projectId === "none" ? "none" : projectId === "all" || !projectId ? "all" : projectId,
      project:
        projectId === "none"
          ? { id: null, name: "None", source: "manual" }
          : project
            ? { id: project.id, name: project.name, source: "manual" }
            : { id: null, name: "All projects", source: "manual" },
      draft: {
        ...draftFromGeneration(draft),
      },
    });

    return jsonResponse(res, 200, { ok: true, event: serializeEvent(updated) });
  } catch (error) {
    console.error("regenerate-draft error:", error);
    return jsonResponse(res, 500, { error: "Failed to regenerate draft" });
  }
}
