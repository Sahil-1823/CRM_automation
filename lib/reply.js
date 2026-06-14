import OpenAI from "openai";
import { getConfig } from "./config.js";

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

export async function generateDraftReply({
  replyMessage,
  yourMessage,
  leadName,
  companyName,
  jobTitle,
  sentiment,
}) {
  const { openai } = getConfig();
  const client = new OpenAI({ apiKey: openai.apiKey });

  const userContent = [
    `Lead: ${leadName || "Unknown"}`,
    jobTitle ? `Title: ${jobTitle}` : null,
    companyName ? `Company: ${companyName}` : null,
    sentiment ? `Detected sentiment: ${sentiment}` : null,
    yourMessage ? `Our previous message:\n${yourMessage}` : null,
    `Lead's reply:\n${replyMessage}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const systemPrompt =
    "You write short, human LinkedIn replies for a sales outreach inbox. " +
    "Tone: warm, direct, no fluff, no emojis, no markdown, no sign-off line. " +
    "If the lead is positive/interested, propose a concrete next step (a quick 15-min call). " +
    "If the lead is neutral, ask one light qualifying question. " +
    "If the lead is negative or unsubscribing, write a polite one-line acknowledgement. " +
    "Keep it under 60 words and never invent facts about the lead or their company.";

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
  return { reply: parsed.reply, rationale: parsed.rationale };
}
