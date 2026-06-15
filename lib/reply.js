import OpenAI from "openai";
import { getConfig } from "./config.js";
import { retrieveContext } from "./rag.js";

const REPLY_SCHEMA = {
  type: "object",
  properties: {
    reply: {
      type: "string",
      description:
        "A short, friendly LinkedIn reply (1-3 sentences). Personal, no emojis, no markdown.",
    },
    rationale: {
      type: "string",
      description: "One short sentence explaining the reply strategy.",
    },
  },
  required: ["reply", "rationale"],
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
    return "The lead is positive/interested. Propose a concrete next step (e.g. a quick 15-min call).";
  }
  return "The lead is negative or neutral. Write a polite, brief response — acknowledge and do not push hard.";
}

export async function generateDraftReply({
  replyMessage,
  yourMessage,
  leadName,
  companyName,
  jobTitle,
  sentiment,
  isPositive,
  conversation,
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
  const ragChunks = await retrieveContext(ragQuery, { topK: 4 });

  const ragBlock = ragChunks.length
    ? ragChunks
        .map((c, i) => `[${i + 1}] (${c.title})\n${c.text}`)
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
    ragBlock ? `Reference material (use only facts from here — do not invent):\n${ragBlock}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  const systemPrompt =
    "You write short, human LinkedIn replies for a sales outreach inbox. " +
    "Tone: warm, direct, no fluff, no emojis, no markdown, no sign-off line. " +
    sentimentGuidance(sentiment, isPositive) +
    " When reference material is provided, weave in relevant facts naturally. " +
    "Keep it under 80 words and never invent facts about the lead, company, or product.";

  const response = await client.chat.completions.create({
    model: openai.model,
    temperature: 0.4,
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
    ragSources: ragChunks.map((c) => ({ title: c.title, excerpt: c.text.slice(0, 200) })),
  };
}
