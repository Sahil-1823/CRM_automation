import { jsonResponse, readJsonBody } from "../lib/http.js";
import { addDocument, listDocuments, deleteDocument, isUsingVector } from "../lib/rag.js";
import { isUsingRedis } from "../lib/store.js";
import { requireAuth } from "../lib/auth.js";

export default async function handler(req, res) {
  try {
    if (!(await requireAuth(req, res))) return;
    const url = new URL(req.url, "http://localhost");
    const id = url.searchParams.get("id");

    if (req.method === "GET") {
      const documents = await listDocuments();
      return jsonResponse(res, 200, {
        documents,
        storage: isUsingRedis() ? "redis" : "none",
        vector: isUsingVector() ? "upstash" : "redis-embeddings",
      });
    }

    if (req.method === "POST") {
      const body = await readJsonBody(req);
      const doc = await addDocument({
        title: body.title,
        content: body.content,
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
    return jsonResponse(res, 500, {
      error: "Internal server error",
      message: error.message,
    });
  }
}
