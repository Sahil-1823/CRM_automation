import test from "node:test";
import assert from "node:assert/strict";
import { parseHeyReachPayload } from "../lib/heyreach.js";

test("parseHeyReachPayload accepts common HeyReach shapes", () => {
  const parsed = parseHeyReachPayload({
    lead: {
      firstName: "Jane",
      lastName: "Doe",
      profileUrl: "https://linkedin.com/in/janedoe/",
      companyName: "Acme Inc",
      position: "VP Sales",
    },
    message: "Sounds good, let's chat next week.",
    yourMessage: "Would you be open to a quick call?",
    eventType: "MESSAGE_REPLY_RECEIVED",
  });

  assert.equal(parsed.valid, true);
  assert.equal(parsed.lead.fullName, "Jane Doe");
  assert.equal(parsed.lead.companyName, "Acme Inc");
  assert.equal(parsed.lead.conversation.length, 2);
  assert.equal(parsed.lead.conversation[0].from, "us");
  assert.equal(parsed.lead.conversation[1].from, "lead");
});

test("parseHeyReachPayload extracts HeyReach send fields", () => {
  const parsed = parseHeyReachPayload({
    lead: {
      fullName: "Jane Doe",
      profileUrl: "https://linkedin.com/in/janedoe",
    },
    message: "Sounds good!",
    conversationId: "conv-123",
    linkedInAccountId: 456,
    eventType: "every_message_reply_received",
  });

  assert.equal(parsed.valid, true);
  assert.equal(parsed.lead.conversationId, "conv-123");
  assert.equal(parsed.lead.linkedInAccountId, 456);
});

test("parseHeyReachPayload parses message thread when provided", () => {
  const parsed = parseHeyReachPayload({
    lead: { fullName: "Jane Doe" },
    message: "Latest reply",
    messages: [
      { text: "Hi Jane, interested in a call?", direction: "outbound" },
      { text: "Sure, tell me more.", isFromLead: true },
      { text: "Latest reply", isFromLead: true },
    ],
  });

  assert.equal(parsed.valid, true);
  assert.equal(parsed.lead.conversation.length, 3);
  assert.equal(parsed.lead.conversation[0].from, "us");
  assert.equal(parsed.lead.conversation[2].text, "Latest reply");
});

test("parseHeyReachPayload extracts campaign id and name", () => {
  const parsed = parseHeyReachPayload({
    lead: { fullName: "Jane Doe" },
    message: "Interested!",
    campaignId: 78901,
    campaign: { id: 78901, name: "Q2 Outbound" },
  });

  assert.equal(parsed.valid, true);
  assert.equal(parsed.lead.campaignId, 78901);
  assert.equal(parsed.lead.campaignName, "Q2 Outbound");
});
