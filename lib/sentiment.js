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
      description:
        "positive if interested; negative if rejecting or asking to stop; neutral if non-committal or unclear",
    },
    reasoning: {
      type: "string",
      description: "Brief explanation for the sentiment classification",
    },
    category: {
      type: "string",
      enum: HANDLING_CATEGORIES,
      description:
        "conversational = normal interest/chit-chat; info_request = question answerable in chat; " +
        "scheduling = lead asks for a call/meeting, proposes a time, or agrees to a suggested slot; " +
        "action_required = lead asks us to act outside chat (submit link, create account/credentials, fill form/assessment, upload files, pay, sign); " +
        "sensitive = pricing/contract/legal/payment/refund/complaint/PII; " +
        "unsubscribe = rejection or stop contacting; unclear = ambiguous",
    },
    handling: {
      type: "string",
      enum: ["auto_ok", "needs_human"],
      description:
        "auto_ok only when a text-only assistant can safely reply without real-world action; otherwise needs_human",
    },
    actionItems: {
      type: "array",
      items: { type: "string" },
      description:
        "Concrete actions the lead is asking us to perform outside chat. Empty array when none.",
    },
    handlingReason: {
      type: "string",
      description: "Why auto_ok or needs_human was chosen",
    },
  },
  required: ["sentiment", "reasoning", "category", "handling", "actionItems", "handlingReason"],
  additionalProperties: false,
};

/**
 * Normalize raw LLM triage output. Fail-safe: unknown/missing -> needs_human.
 */
export function normalizeTriage(parsed) {
  if (!parsed || typeof parsed !== "object") {
    return {
      sentiment: "neutral",
      reasoning: "Classification unavailable",
      isPositive: false,
      category: "unclear",
      schedulingIntent: false,
      requestedTime: null,
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
    ? parsed.actionItems
        .filter((item) => typeof item === "string" && item.trim())
        .map((item) => item.trim())
    : [];

  let requiresHuman =
    parsed.handling === "needs_human" ||
    !AUTO_OK_CATEGORIES.has(category) ||
    category === "unclear";

  if (parsed.handling === "auto_ok" && AUTO_OK_CATEGORIES.has(category)) {
    requiresHuman = false;
  }

  const handlingReason =
    typeof parsed.handlingReason === "string" && parsed.handlingReason.trim()
      ? parsed.handlingReason.trim()
      : requiresHuman
        ? "Reply requires human review"
        : "Safe for automated draft";

  return {
    sentiment,
    reasoning:
      typeof parsed.reasoning === "string" && parsed.reasoning.trim()
        ? parsed.reasoning.trim()
        : "No reasoning provided",
    isPositive: sentiment === "positive",
    category,
    schedulingIntent: category === "scheduling",
    requestedTime: null,
    requiresHuman,
    actionItems,
    handlingReason,
  };
}

/**
 * Classify sentiment + handling triage in one LLM call.
 */
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
      json_schema: {
        name: "reply_triage",
        strict: true,
        schema: REPLY_TRIAGE_SCHEMA,
      },
    },
    messages: [
      {
        role: "system",
        content:
          'Classify LinkedIn outreach replies for sentiment AND handling.\n\n' +
          'Sentiment: "positive" = interest/openness; "negative" = rejection/unsubscribe; "neutral" = vague/non-committal.\n\n' +
          "Handling — decide if a text-only assistant can safely reply WITHOUT real-world action:\n" +
          '- auto_ok + conversational: normal interest, chit-chat\n' +
          '- auto_ok + info_request: questions answerable in a chat message from general/product knowledge\n' +
          '- auto_ok + scheduling: wants a call/meeting, proposes a time, or agrees to a suggested slot\n' +
          '- needs_human + action_required: submit/apply at a link, register, create credentials/account, fill form/questionnaire/assessment, upload/send resume/docs/files, payment, signature\n' +
          '- needs_human + sensitive: pricing negotiation, contract, legal, refund, complaint, PII requests\n' +
          '- needs_human + unsubscribe: rejection or ask to stop contacting\n' +
          '- needs_human + unclear: ambiguous or unsure\n\n' +
          "Be conservative: when unsure, use needs_human and category unclear.\n" +
          "Extract concrete actionItems when the lead asks us to do something outside chat.",
      },
      {
        role: "user",
        content: userContent,
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned an empty triage response");
  }

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
