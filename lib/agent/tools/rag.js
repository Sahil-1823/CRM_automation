import { registerTool } from "../tools.js";
import { retrieveContext } from "../../rag.js";

registerTool("searchKnowledge", {
  description: "Search project knowledge base for facts to use in the reply",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
      projectId: { type: "string", description: "Project id or 'all'" },
      query: { type: "string" },
      projectId: { type: "string" },
    },
    required: ["query"],
  },
  handler: async ({ query, projectId = "all" }) => {
    const chunks = await retrieveContext(query, {
      topK: 5,
      projectId: projectId || "all",
      rewrite: true,
    });
    return {
      chunks: chunks.map((c) => ({
        title: c.title,
        text: c.text,
        score: c.score,
      })),
    };
  },
});
