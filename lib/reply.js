import OpenAI from "openai";
import { getConfig } from "./config.js";
import { retrieveContext } from "./rag.js";

const REPLY_SCHEMA = {
  type: "object",
  properties: {
    reply: {
      type: "string",
      description:
        "A natural LinkedIn DM reply (1-3 short sentences). Sounds like a real person typed it on their phone — casual, warm, not salesy.",
    },
    rationale: {
      type: "string",
      description: "One short sentence explaining the reply strategy.",
    },
    citedSources: {
      type: "array",
      items: { type: "string" },
      description:
        "Titles of reference documents you actually used in the reply. Empty array if you used none.",
    },
    hasGrounding: {
      type: "boolean",
      description:
        "True if the reply draws specific facts from the reference material. False if you relied on general knowledge only.",
    },
  },
  required: ["reply", "rationale", "citedSources", "hasGrounding"],
  additionalProperties: false,
};

function buildRagQuery({ replyMessage, yourMessage, leadName, companyName, conversation }) {
  const thread = (conversation || [])
    .map((m) => `${m.from === "lead" ? "Lead" : "Us"}: ${m.text}`)
    .join("\n");

  return [
    leadName ? `Lead: ${leadName}` : null,
    companyName ? `Company: ${companyName}` : null,
    thread || null,
    yourMessage ? `Our message: ${yourMessage}` : null,
    `Lead reply: ${replyMessage}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function sentimentGuidance(sentiment, isPositive) {
  if (isPositive || sentiment === "positive") {
    return "The lead seems positive or interested — when it fits, propose a concrete next step (e.g. a quick call). ";
  }
  if (sentiment === "negative") {
    return "The lead seems negative — stay polite and brief, acknowledge their position, and do not push hard. ";
  }
  return "The lead seems neutral — stay polite and brief, answer questions if any, and leave the door open without being pushy. ";
}

/**
 * Generate a draft LinkedIn reply with:
 *   - Project-scoped RAG retrieval (falls back to global docs if no project)
 *   - LLM query rewriting for better chunk retrieval
 *   - Score-thresholded context (irrelevant chunks are dropped)
 *   - Citation tracking (model reports which sources it actually used)
 *   - Project-specific system prompt injection
 *   - Grounding flag (distinguishes RAG-backed vs knowledge-only replies)
 */
export async function generateDraftReply({
  replyMessage,
  yourMessage,
  leadName,
  companyName,
  jobTitle,
  sentiment,
  isPositive,
  conversation,
  project = null,
  projectScope = "project",
}) {
  const { openai } = getConfig();
  const client = new OpenAI({ apiKey: openai.apiKey });

  const ragQuery = buildRagQuery({
    replyMessage,
    yourMessage,
    leadName,
    companyName,
    conversation,
  });

  const skipRag = projectScope === "none";
  const useAllProjects = !skipRag && (projectScope === "all" || !project);
  const ragChunks = skipRag
    ? []
    : await retrieveContext(ragQuery, {
        topK: 5,
        projectId: useAllProjects ? "all" : project.id,
        rewrite: true,
      });

  const ragBlock = ragChunks.length
    ? ragChunks
        .map((c, i) => `[${i + 1}] source: "${c.title}"\n${c.text}`)
        .join("\n\n")
    : null;

  const userContent = [
    `Lead: ${leadName || "Unknown"}`,
    jobTitle ? `Title: ${jobTitle}` : null,
    companyName ? `Company: ${companyName}` : null,
    sentiment ? `Detected sentiment: ${sentiment}` : null,
    conversation?.length
      ? `Conversation thread:\n${conversation.map((m) => `${m.from === "lead" ? "Lead" : "Us"}: ${m.text}`).join("\n")}`
      : null,
    yourMessage && !conversation?.length ? `Our previous message:\n${yourMessage}` : null,
    !conversation?.length ? `Lead's latest reply:\n${replyMessage}` : null,
    skipRag
      ? "No reference material provided — write from general knowledge and the conversation only."
      : ragBlock
        ? `Reference material — use only facts stated here, do not invent:\n${ragBlock}`
        : "No relevant reference material found — rely on general knowledge only.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const basePrompt =
    "You write LinkedIn DMs the way a real person would — not a bot, not a marketing email. " +
    "Style rules: use contractions (I'm, we'd, that's), keep sentences short, sound like you're typing on your phone. " +
    "No emojis, no markdown, no bullet points, no 'Hope this finds you well', no 'Best regards', no sign-off. " +
    "Don't sound overly polished or corporate — a little informal is good. " +
    "Never use phrases like 'I'd be happy to', 'leverage', 'synergy', 'touch base', or 'circle back'. " +
    sentimentGuidance(sentiment, isPositive) +
    " When reference material is provided, weave in relevant facts naturally like you'd mention them in conversation. " +
    "List the source title(s) you actually used in citedSources. " +
    "Keep reply under 60 words. Never invent facts about the lead, company, or product. " +
    "If the reference material is irrelevant, still write a good human reply but set citedSources to [] and hasGrounding to false.";

  const systemPrompt = project?.systemPrompt
    ? `${basePrompt}\n\nProject context for this campaign: ${project.systemPrompt}`
    : basePrompt;

  const response = await client.chat.completions.create({
    model: openai.model,
    temperature: 0.65,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "draft_reply",
        strict: true,
        schema: REPLY_SCHEMA,
      },
    },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned an empty reply draft");
  }

  const parsed = JSON.parse(content);

  return {
    reply: parsed.reply,
    rationale: parsed.rationale,
    citedSources: parsed.citedSources || [],
    hasGrounding: parsed.hasGrounding || false,
    ragSources: ragChunks.map((c) => ({
      title: c.title,
      excerpt: c.text.slice(0, 200),
      score: c.score,
    })),
    projectId: skipRag ? "none" : useAllProjects ? "all" : project?.id || null,
    projectName: skipRag ? "None" : useAllProjects ? "All projects" : project?.name || null,
  };
}
