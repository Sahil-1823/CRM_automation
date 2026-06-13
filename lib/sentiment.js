import OpenAI from "openai";
import { getConfig } from "./config.js";

const SENTIMENT_SCHEMA = {
  type: "object",
  properties: {
    sentiment: {
      type: "string",
      enum: ["positive", "negative/neutral"],
      description:
        "positive if the lead shows interest, curiosity, or willingness to continue; otherwise negative/neutral",
    },
    reasoning: {
      type: "string",
      description: "Brief explanation for the classification",
    },
  },
  required: ["sentiment", "reasoning"],
  additionalProperties: false,
};

export async function classifyReplySentiment({ replyMessage, yourMessage, leadName, companyName }) {
  const { openai } = getConfig();
  const client = new OpenAI({ apiKey: openai.apiKey });

  const userContent = [
    `Lead: ${leadName || "Unknown"}`,
    companyName ? `Company: ${companyName}` : null,
    yourMessage ? `Our previous message:\n${yourMessage}` : null,
    `Lead reply:\n${replyMessage}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const response = await client.chat.completions.create({
    model: openai.model,
    temperature: 0,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "sentiment_classification",
        strict: true,
        schema: SENTIMENT_SCHEMA,
      },
    },
    messages: [
      {
        role: "system",
        content:
          'Classify LinkedIn outreach replies as "positive" or "negative/neutral". ' +
          'Use "positive" when the lead expresses interest, asks to learn more, agrees to a call, ' +
          "or otherwise signals openness to continue. Use \"negative/neutral\" for rejections, " +
          "unsubscribe requests, one-word non-committal replies, or unclear/no-interest responses.",
      },
      {
        role: "user",
        content: userContent,
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned an empty sentiment response");
  }

  const parsed = JSON.parse(content);
  return {
    sentiment: parsed.sentiment,
    reasoning: parsed.reasoning,
    isPositive: parsed.sentiment === "positive",
  };
}
