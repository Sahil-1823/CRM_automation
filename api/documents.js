import path from "node:path";
import { jsonResponse, readJsonBody } from "../lib/http.js";
import {
  addDocument,
  listDocuments,
  deleteDocument,
  getDocumentMarkdown,
} from "../lib/rag.js";
import { requireAuth } from "../lib/auth.js";
import { convertFileToMarkdown } from "../lib/convert-to-md.js";

function stripExtension(filename) {
  return path.basename(filename, path.extname(filename));
}

export default async function handler(req, res) {
  try {
    if (!(await requireAuth(req, res))) return;
    const url = new URL(req.url, "http://localhost");
    const id = url.searchParams.get("id");

    if (req.method === "GET") {
      if (id) {
        const stored = await getDocumentMarkdown(id);
        if (!stored) return jsonResponse(res, 404, { error: "Document not found" });
        return jsonResponse(res, 200, {
          id,
          markdown: stored.markdown,
          sourceFilename: stored.sourceFilename,
        });
      }

      const documents = await listDocuments();
      return jsonResponse(res, 200, { documents });
    }

    if (req.method === "POST") {
      const body = await readJsonBody(req);

      // File upload: { filename, data: base64, projectId? }
      if (body.filename && body.data) {
        const buffer = Buffer.from(body.data, "base64");
        const converted = await convertFileToMarkdown(buffer, body.filename);
        const title = body.title?.trim() || stripExtension(body.filename);

        const doc = await addDocument({
          title,
          content: converted.markdown,
          sourceFilename: converted.sourceFilename,
          markdownStored: true,
          projectId: body.projectId || "global",
        });

        return jsonResponse(res, 201, {
          document: doc,
          converted: {
            format: "md",
            sourceExt: converted.sourceExt,
            preview: converted.markdown.slice(0, 500),
          },
        });
      }

      // Paste as markdown / plain text
      const pasted = body.content?.trim() || "";
      const title = body.title?.trim();
      if (!title) return jsonResponse(res, 400, { error: "Document title is required" });
      if (!pasted) return jsonResponse(res, 400, { error: "Document content is required" });

      const markdown = pasted.startsWith("# ") ? pasted : `# ${title}\n\n${pasted}`;
      const doc = await addDocument({
        title,
        content: markdown,
        sourceFilename: null,
        markdownStored: true,
        projectId: body.projectId || "global",
      });

      return jsonResponse(res, 201, { document: doc });
    }

    if (req.method === "DELETE") {
      if (!id) return jsonResponse(res, 400, { error: "Missing ?id=" });
      const result = await deleteDocument(id);
      return jsonResponse(res, 200, result);
    }

    return jsonResponse(res, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error("documents api error:", error);
    return jsonResponse(res, 500, { error: "Internal server error" });
  }
}
