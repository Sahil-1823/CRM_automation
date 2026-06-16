import test from "node:test";
import assert from "node:assert/strict";
import {
  parseHeyReachPayload,
  formatHeyReachMessageType,
  verifyHeyReachSecret,
  parseChatroomToThread,
  mergeIncomingThreads,
} from "../lib/heyreach.js";
import { isFilterableCampaignStatus } from "../lib/heyreach-meta.js";

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
      {
        text: "Hi Jane, interested in a call?",
        direction: "outbound",
        createdAt: "2026-06-10T10:00:00.000Z",
      },
      {
        text: "Sure, tell me more.",
        isFromLead: true,
        createdAt: "2026-06-10T11:00:00.000Z",
      },
      { text: "Latest reply", isFromLead: true, createdAt: "2026-06-10T12:00:00.000Z" },
    ],
  });

  assert.equal(parsed.valid, true);
  assert.equal(parsed.lead.conversation.length, 3);
  assert.equal(parsed.lead.conversation[0].at, "2026-06-10T10:00:00.000Z");
  assert.equal(parsed.lead.conversation[2].at, "2026-06-10T12:00:00.000Z");
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

test("parseHeyReachPayload extracts message type from eventType", () => {
  const parsed = parseHeyReachPayload({
    lead: { fullName: "Jane Doe" },
    message: "Thanks!",
    eventType: "inmail_reply_received",
  });

  assert.equal(parsed.valid, true);
  assert.equal(parsed.lead.messageType, "inmail_reply_received");
});

test("parseHeyReachPayload accepts HeyReach recent_messages and sender.id shape", () => {
  const parsed = parseHeyReachPayload({
    event_type: "every_message_reply_received",
    conversation_id: "conv-real-99",
    sender: {
      id: 987654,
      firstName: "Alex",
      lastName: "Sales",
    },
    lead: {
      first_name: "Jane",
      last_name: "Doe",
      profile_url: "https://linkedin.com/in/janedoe",
      company_name: "Acme Inc",
    },
    recent_messages: [
      { text: "Hi Jane, would you be open to a quick call?", direction: "outbound" },
      { text: "Yes, let's chat next week!", direction: "inbound" },
    ],
  });

  assert.equal(parsed.valid, true);
  assert.equal(parsed.lead.fullName, "Jane Doe");
  assert.equal(parsed.lead.replyMessage, "Yes, let's chat next week!");
  assert.equal(parsed.lead.yourMessage, "Hi Jane, would you be open to a quick call?");
  assert.equal(parsed.lead.conversationId, "conv-real-99");
  assert.equal(parsed.lead.linkedInAccountId, 987654);
  assert.equal(parsed.lead.linkedInAccountName, "Alex Sales");
  assert.equal(parsed.lead.conversation.length, 2);
  assert.equal(parsed.lead.conversation[1].from, "lead");
});

test("parseHeyReachPayload derives reply from last recent_message when direction is missing", () => {
  const parsed = parseHeyReachPayload({
    prospect: { fullName: "Sam Lee" },
    conversation_id: "conv-55",
    sender: { id: 111 },
    recent_messages: [{ body: "Our initial pitch." }, { body: "Tell me more." }],
  });

  assert.equal(parsed.valid, true);
  assert.equal(parsed.lead.replyMessage, "Tell me more.");
});

test("parseHeyReachPayload reads recent_messages nested under lead", () => {
  const parsed = parseHeyReachPayload({
    conversation_id: "conv-nested",
    sender: { id: 222 },
    lead: {
      first_name: "Jane",
      last_name: "Doe",
      recent_messages: [
        { text: "Hi Jane, interested in a call?", direction: "outbound" },
        { text: "Sure, tell me more.", direction: "inbound" },
        { text: "Here are the details.", direction: "outbound" },
        { text: "Sounds good!", direction: "inbound" },
      ],
    },
  });

  assert.equal(parsed.valid, true);
  assert.equal(parsed.lead.conversation.length, 4);
  assert.equal(parsed.lead.conversation[0].from, "us");
  assert.equal(parsed.lead.conversation[3].from, "lead");
});

test("parseChatroomToThread maps HeyReach inbox API messages", () => {
  const thread = parseChatroomToThread({
    messages: [
      { text: "Hello", isIncoming: false, sentAt: "2026-06-10T10:00:00.000Z" },
      { text: "Interested", isIncoming: true, sentAt: "2026-06-10T11:00:00.000Z" },
      { text: "Great, Tuesday?", isIncoming: false, sentAt: "2026-06-10T12:00:00.000Z" },
    ],
  });

  assert.equal(thread.length, 3);
  assert.equal(thread[0].from, "us");
  assert.equal(thread[1].from, "lead");
  assert.equal(thread[2].at, "2026-06-10T12:00:00.000Z");
  assert.equal(thread[2].atSource, "heyreach_api");
});

test("parseChatroomToThread carries message ids when provided", () => {
  const thread = parseChatroomToThread({
    messages: [
      { id: "m1", text: "Hello", isIncoming: false },
      { id: "m2", text: "Interested", isIncoming: true },
    ],
  });

  assert.equal(thread[0].id, "m1");
  assert.equal(thread[1].id, "m2");
});

test("parseHeyReachPayload tags webhook timestamps with heyreach_webhook source", () => {
  const parsed = parseHeyReachPayload({
    conversation_id: "c-src",
    sender: { id: 7 },
    lead: { firstName: "Jane", lastName: "Doe" },
    recent_messages: [
      { id: "w1", text: "Hi", direction: "outbound", sentAt: "2026-06-10T10:00:00.000Z" },
      { id: "w2", text: "Yes", direction: "inbound", sentAt: "2026-06-10T11:00:00.000Z" },
    ],
  });

  assert.equal(parsed.lead.conversation[0].atSource, "heyreach_webhook");
  assert.equal(parsed.lead.conversation[0].id, "w1");
  assert.equal(parsed.lead.conversation[1].id, "w2");
});

test("mergeIncomingThreads prefers full API history over sparse webhook", () => {
  const merged = mergeIncomingThreads(
    [{ from: "lead", text: "Latest only" }],
    [
      { from: "us", text: "Hello" },
      { from: "lead", text: "Interested" },
      { from: "lead", text: "Latest only" },
    ],
  );

  assert.equal(merged.length, 3);
  assert.equal(merged[0].text, "Hello");
  assert.equal(merged.at(-1).text, "Latest only");
});

test("mergeIncomingThreads dedupes by message id even with different text spacing", () => {
  const merged = mergeIncomingThreads(
    [{ id: "x1", from: "lead", text: "Following up " }, { from: "lead", text: "Brand new" }],
    [{ id: "x1", from: "lead", text: "Following up" }],
  );

  // x1 must not double up
  assert.equal(merged.filter((m) => m.id === "x1").length, 1);
  assert.ok(merged.some((m) => m.text === "Brand new"));
});

test("formatHeyReachMessageType humanizes webhook types", () => {
  assert.equal(formatHeyReachMessageType("every_message_reply_received"), "Reply received");
  assert.equal(formatHeyReachMessageType("MESSAGE_REPLY_RECEIVED"), "First reply");
});

test("isFilterableCampaignStatus excludes completed campaigns", () => {
  assert.equal(isFilterableCampaignStatus("IN_PROGRESS"), true);
  assert.equal(isFilterableCampaignStatus("PAUSED"), true);
  assert.equal(isFilterableCampaignStatus("FINISHED"), false);
  assert.equal(isFilterableCampaignStatus("COMPLETED"), false);
});

test("verifyHeyReachSecret accepts Authorization Bearer and custom headers", () => {
  const secret = "my-secret-token";
  assert.equal(
    verifyHeyReachSecret(
      { headers: { authorization: "Bearer my-secret-token" } },
      secret,
    ),
    true,
  );
  assert.equal(
    verifyHeyReachSecret(
      { headers: { heyreach_webhook_secret: "Bearer my-secret-token" } },
      secret,
    ),
    true,
  );
  assert.equal(
    verifyHeyReachSecret(
      { headers: { authorization: "Bearer wrong" } },
      secret,
    ),
    false,
  );
  assert.equal(
    verifyHeyReachSecret(
      { headers: { authorization: "Bearer my-secret-token" } },
      "Bearer my-secret-token",
    ),
    true,
  );
});
