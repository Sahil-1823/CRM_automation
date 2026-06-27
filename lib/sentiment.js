import OpenAI from "openai";
import { getConfig } from "./config.js";

export const HANDLING_CATEGORIES = [
  "conversational",
  "info_request",
  "scheduling",
  "action_required",
  "sensitive",
  "unsubscribe",
  "unclear",
];

const AUTO_OK_CATEGORIES = new Set(["conversational", "info_request", "scheduling"]);

const REPLY_TRIAGE_SCHEMA = {
  type: "object",
  properties: {
    sentiment: {
      type: "string",
      enum: ["positive", "negative", "neutral"],
    },
    reasoning: { type: "string" },
    category: {
      type: "string",
      enum: HANDLING_CATEGORIES,
    },
    handling: {
      type: "string",
      enum: ["auto_ok", "needs_human"],
    },
    actionItems: {
      type: "array",
      items: { type: "string" },
    },
    handlingReason: { type: "string" },
  },
  required: ["sentiment", "reasoning", "category", "handling", "actionItems", "handlingReason"],
  additionalProperties: false,
};

export function normalizeTriage(parsed) {
  if (!parsed || typeof parsed !== "object") {
    return {
      sentiment: "neutral",
      reasoning: "Classification unavailable",
      isPositive: false,
      category: "unclear",
      schedulingIntent: false,
      requiresHuman: true,
      actionItems: [],
      handlingReason: "Could not classify reply — defaulting to human review",
    };
  }

  const sentiment = ["positive", "negative", "neutral"].includes(parsed.sentiment)
    ? parsed.sentiment
    : "neutral";
  const category = HANDLING_CATEGORIES.includes(parsed.category) ? parsed.category : "unclear";
  const actionItems = Array.isArray(parsed.actionItems)
    ? parsed.actionItems.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
    : [];

  let requiresHuman =
    parsed.handling === "needs_human" ||
    !AUTO_OK_CATEGORIES.has(category) ||
    category === "unclear";

  if (parsed.handling === "auto_ok" && AUTO_OK_CATEGORIES.has(category)) {
    requiresHuman = false;
  }

  return {
    sentiment,
    reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning.trim() : "No reasoning provided",
    isPositive: sentiment === "positive",
    category,
    schedulingIntent: category === "scheduling",
    requiresHuman,
    actionItems,
    handlingReason:
      typeof parsed.handlingReason === "string" && parsed.handlingReason.trim()
        ? parsed.handlingReason.trim()
        : requiresHuman
          ? "Reply requires human review"
          : "Safe for automated draft",
  };
}

export async function classifyReply({
  replyMessage,
  yourMessage,
  leadName,
  companyName,
  conversation,
}) {
  const { openai } = getConfig();
  const client = new OpenAI({ apiKey: openai.apiKey });

  const thread = (conversation || [])
    .map((m) => `${m.from === "lead" ? "Lead" : "Us"}: ${m.text}`)
    .join("\n");

  const userContent = [
    `Lead: ${leadName || "Unknown"}`,
    companyName ? `Company: ${companyName}` : null,
    thread ? `Conversation thread:\n${thread}` : null,
    yourMessage && !thread ? `Our previous message:\n${yourMessage}` : null,
    `Lead's latest reply:\n${replyMessage}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const response = await client.chat.completions.create({
    model: openai.model,
    temperature: 0,
    response_format: {
      type: "json_schema",
      json_schema: { name: "reply_triage", strict: true, schema: REPLY_TRIAGE_SCHEMA },
    },
    messages: [
      {
        role: "system",
        content:
          "Classify replies for sentiment AND handling. " +
          "auto_ok + scheduling: wants a call/meeting or agrees to a time. " +
          "needs_human + action_required: real-world action outside chat. " +
          "Be conservative when unsure.",
      },
      { role: "user", content: userContent },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned an empty triage response");
  return normalizeTriage(JSON.parse(content));
}

/** @deprecated use classifyReply */
export async function classifyReplySentiment(args) {
  const triage = await classifyReply(args);
  return {
    sentiment: triage.sentiment,
    reasoning: triage.reasoning,
    isPositive: triage.isPositive,
  };
}
