import { jsonResponse, readJsonBody } from "../lib/http.js";
import { requireAuth } from "../lib/auth.js";
import {
  listProjects,
  createProject,
  updateProject,
  deleteProject,
} from "../lib/projects.js";

export default async function handler(req, res) {
  try {
    if (!(await requireAuth(req, res))) return;

    const url = new URL(req.url, "http://localhost");
    const id = url.searchParams.get("id");

    if (req.method === "GET") {
      return jsonResponse(res, 200, { projects: await listProjects() });
    }

    if (req.method === "POST") {
      const body = await readJsonBody(req);
      const project = await createProject(body);
      return jsonResponse(res, 201, { project });
    }

    if (req.method === "PATCH") {
      if (!id) return jsonResponse(res, 400, { error: "Missing ?id=" });
      const body = await readJsonBody(req);
      const project = await updateProject(id, body);
      return jsonResponse(res, 200, { project });
    }

    if (req.method === "DELETE") {
      if (!id) return jsonResponse(res, 400, { error: "Missing ?id=" });
      const result = await deleteProject(id);
      return jsonResponse(res, 200, result);
    }

    return jsonResponse(res, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error("projects api error:", error);
    return jsonResponse(res, 500, { error: "Internal server error" });
  }
}
