import OpenAI from "openai";
import { getConfig } from "../config.js";
import { getGoogleCalendarConfig } from "../calendar/config.js";
import { formatSlotLabel } from "../calendar/slots.js";

const INTENT_SCHEMA = {
  type: "object",
  properties: {
    wantsMeeting: {
      type: "boolean",
      description: "True if the lead wants to schedule or confirm a call/meeting",
    },
    confirmsPriorSlot: {
      type: "boolean",
      description: "True if the lead is agreeing to a time we previously offered",
    },
    preferredStart: {
      type: ["string", "null"],
      description: "ISO 8601 datetime for requested/confirmed start in the calendar timezone, or null if unknown",
    },
    durationMinutes: {
      type: "number",
      description: "Meeting duration in minutes (default 30)",
    },
    timezoneHint: {
      type: ["string", "null"],
      description: "IANA timezone if mentioned, else null",
    },
    reasoning: {
      type: "string",
      description: "Brief explanation",
    },
  },
  required: [
    "wantsMeeting",
    "confirmsPriorSlot",
    "preferredStart",
    "durationMinutes",
    "timezoneHint",
    "reasoning",
  ],
  additionalProperties: false,
};

/**
 * Parse scheduling intent from the latest lead message.
 */
export async function parseSchedulingIntent({
  replyMessage,
  conversation,
  priorProposedSlots = [],
}) {
  const { openai } = getConfig();
  const { timezone, defaultDurationMin } = getGoogleCalendarConfig();
  const client = new OpenAI({ apiKey: openai.apiKey });

  const thread = (conversation || [])
    .map((m) => `${m.from === "lead" ? "Lead" : "Us"}: ${m.text}`)
    .join("\n");

  const slotsBlock =
    priorProposedSlots.length > 0
      ? `Previously proposed slots:\n${priorProposedSlots
          .map((s, i) => `${i + 1}. ${s.label || s.start} (${s.start} to ${s.end})`)
          .join("\n")}`
      : "No prior proposed slots.";

  const response = await client.chat.completions.create({
    model: openai.model,
    temperature: 0,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "scheduling_intent",
        strict: true,
        schema: INTENT_SCHEMA,
      },
    },
    messages: [
      {
        role: "system",
        content:
          "Extract meeting scheduling intent from LinkedIn DMs. " +
          `Default timezone: ${timezone}. ` +
          "If the lead proposes or confirms a time, set preferredStart as ISO 8601 with offset. " +
          "If they agree to one of our proposed slots, set confirmsPriorSlot true and preferredStart to that slot's start.",
      },
      {
        role: "user",
        content: [thread ? `Thread:\n${thread}` : null, `Latest lead message:\n${replyMessage}`, slotsBlock]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    return {
      wantsMeeting: false,
      confirmsPriorSlot: false,
      preferredStart: null,
      durationMinutes: defaultDurationMin,
      timezoneHint: null,
      reasoning: "No scheduling intent parsed",
    };
  }

  const parsed = JSON.parse(content);
  return {
    wantsMeeting: !!parsed.wantsMeeting,
    confirmsPriorSlot: !!parsed.confirmsPriorSlot,
    preferredStart: parsed.preferredStart || null,
    durationMinutes: parsed.durationMinutes || defaultDurationMin,
    timezoneHint: parsed.timezoneHint || null,
    reasoning: parsed.reasoning || "",
  };
}

/**
 * Match lead reply text to a previously proposed slot (rules + fuzzy).
 */
export function matchLeadReplyToProposedSlot(replyMessage, proposedSlots = []) {
  if (!replyMessage || !proposedSlots.length) return null;

  const text = replyMessage.toLowerCase();
  const numberMatch = text.match(/\b(?:option\s*)?([1-3])\b/);
  if (numberMatch) {
    const idx = Number(numberMatch[1]) - 1;
    if (proposedSlots[idx]) return proposedSlots[idx];
  }

  for (const slot of proposedSlots) {
    const label = (slot.label || "").toLowerCase();
    if (label && text.includes(label.slice(0, 12))) return slot;
    const dayMatch = label.match(/\b(mon|tue|wed|thu|fri|sat|sun)/i);
    if (dayMatch && text.includes(dayMatch[0].toLowerCase())) {
      const timeMatch = label.match(/(\d{1,2}:\d{2}|\d{1,2}\s*(?:am|pm))/i);
      if (timeMatch && text.includes(timeMatch[0].toLowerCase().replace(/\s/g, ""))) {
        return slot;
      }
      if (text.includes("works") || text.includes("sounds good") || text.includes("yes")) {
        return slot;
      }
    }
  }

  return null;
}

export function buildPendingBook({
  start,
  end,
  leadName,
  companyName,
  campaignName,
  linkedInUrl,
  conversationId,
  conversation,
}) {
  const snippet = (conversation || [])
    .slice(-4)
    .map((m) => `${m.from === "lead" ? "Lead" : "Us"}: ${m.text}`)
    .join("\n");

  const title = `Call with ${leadName || "lead"}${companyName ? ` (${companyName})` : ""}`;
  const description = [
    `Lead: ${leadName || "Unknown"}`,
    companyName ? `Company: ${companyName}` : null,
    campaignName ? `Campaign: ${campaignName}` : null,
    linkedInUrl ? `LinkedIn: ${linkedInUrl}` : null,
    conversationId ? `HeyReach conversation: ${conversationId}` : null,
    snippet ? `\nRecent thread:\n${snippet}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    start,
    end,
    title,
    description,
    label: formatSlotLabel(start, end, getGoogleCalendarConfig().timezone),
  };
}
