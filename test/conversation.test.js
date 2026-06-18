import test from "node:test";
import assert from "node:assert/strict";
import {
  enrichDisplayThread,
  mergeConversationHistory,
  mergeWebhookConversation,
  conversationFromEvent,
  evaluateInboundWebhook,
  buildConversationSyncPatch,
  buildConversationOnlyPatch,
  syncAllLeadConversationEvents,
  appendOurMessage,
  buildEnsuredConversationEvent,
} from "../lib/conversation.js";

test("enrichDisplayThread builds two-sided chat from sparse webhook data", () => {
  const thread = enrichDisplayThread({
    conversation: [{ from: "lead", text: "Tell me more." }],
    yourMessage: "Hi, would you be open to a quick call?",
    replyMessage: "Tell me more.",
  });

  assert.equal(thread.length, 2);
  assert.equal(thread[0].from, "us");
  assert.equal(thread[1].from, "lead");
});

test("enrichDisplayThread appends sent reply", () => {
  const thread = enrichDisplayThread({
    conversation: [
      { from: "us", text: "Hello" },
      { from: "lead", text: "Interested" },
    ],
    sentReply: "Great, how about Tuesday?",
  });

  assert.equal(thread.at(-1).from, "us");
  assert.equal(thread.at(-1).text, "Great, how about Tuesday?");
});

test("conversationFromEvent includes sent message from HeyReach send", () => {
  const thread = conversationFromEvent({
    status: "sent",
    sentAt: "2026-06-10T14:00:00.000Z",
    sendResult: { reply: "Thanks, talk soon." },
    lead: {
      conversation: [
        { from: "us", text: "Hello", at: "2026-06-10T10:00:00.000Z" },
        { from: "lead", text: "Interested", at: "2026-06-10T11:00:00.000Z" },
      ],
    },
  });

  const sent = thread.find((m) => m.from === "us" && m.text === "Thanks, talk soon.");
  assert.ok(sent);
  assert.equal(sent.at, "2026-06-10T14:00:00.000Z");
});

test("enrichDisplayThread does not duplicate reply text shown as unknown", () => {
  const thread = enrichDisplayThread({
    conversation: [{ from: "unknown", text: "Tell me more." }],
    replyMessage: "Tell me more.",
    yourMessage: "Hi there",
  });

  assert.equal(thread.filter((m) => m.text === "Tell me more.").length, 1);
  assert.equal(thread.find((m) => m.text === "Tell me more.").from, "lead");
});

test("mergeConversationHistory dedupes repeated messages", () => {
  const merged = mergeConversationHistory(
    [{ from: "us", text: "Hi" }],
    [
      { from: "us", text: "Hi" },
      { from: "lead", text: "Hello" },
    ],
  );

  assert.equal(merged.length, 2);
});

test("evaluateInboundWebhook skips when latest message is ours", () => {
  const result = evaluateInboundWebhook({
    priorEvent: null,
    priorThread: [],
    mergedConversation: [
      { from: "us", text: "Thanks!" },
      { from: "lead", text: "Old reply" },
      { from: "us", text: "We already responded" },
    ],
    incomingReplyMessage: "Old reply",
  });

  assert.equal(result.process, false);
  assert.equal(result.reason, "already_replied");
});

test("evaluateInboundWebhook skips already handled sent reply", () => {
  const priorThread = [
    { from: "us", text: "Hi" },
    { from: "lead", text: "Interested" },
    { from: "us", text: "Great, let's chat" },
  ];
  const result = evaluateInboundWebhook({
    priorEvent: {
      status: "sent",
      sendResult: { reply: "Great, let's chat" },
      lead: { replyMessage: "Interested" },
    },
    priorThread,
    mergedConversation: [
      { from: "us", text: "Hi" },
      { from: "lead", text: "Interested" },
      { from: "us", text: "Great, let's chat" },
    ],
    incomingReplyMessage: "Interested",
  });

  assert.equal(result.process, false);
});

test("evaluateInboundWebhook accepts new lead reply after sent", () => {
  const priorThread = [
    { from: "us", text: "Hi" },
    { from: "lead", text: "Interested" },
    { from: "us", text: "Great, let's chat" },
  ];
  const merged = [
    ...priorThread,
    { from: "lead", text: "Tuesday works for me" },
  ];
  const result = evaluateInboundWebhook({
    priorEvent: {
      status: "sent",
      sendResult: { reply: "Great, let's chat" },
      lead: { replyMessage: "Interested" },
    },
    priorThread,
    mergedConversation: merged,
    incomingReplyMessage: "Tuesday works for me",
  });

  assert.equal(result.process, true);
  assert.equal(result.latestLeadReply, "Tuesday works for me");
});

test("buildConversationSyncPatch keeps merged thread when already replied", () => {
  const patch = buildConversationSyncPatch(
    {
      id: "evt_1",
      status: "sent",
      sentAt: "2026-06-10T12:00:00.000Z",
      sendResult: { reply: "Thanks, talk soon." },
      lead: { replyMessage: "Sounds good", conversation: [] },
    },
    [
      { from: "lead", text: "Sounds good", at: "2026-06-10T11:00:00.000Z" },
      { from: "us", text: "Thanks, talk soon.", at: "2026-06-10T12:00:00.000Z" },
    ],
    { fullName: "Jane Doe" },
  );

  assert.equal(patch.lead.conversation.length, 2);
  assert.equal(patch.lead.conversation[1].from, "us");
  assert.equal(patch.sendResult.reply, "Thanks, talk soon.");
});

test("mergeWebhookConversation keeps prior-only messages and applies HeyReach order", () => {
  const merged = mergeWebhookConversation({
    priorEvent: null,
    priorThread: [
      { from: "us", text: "Hi" },
      { from: "lead", text: "Interested" },
      { from: "us", text: "Sent from dashboard only" },
    ],
    incomingThread: [
      { from: "us", text: "Hi" },
      { from: "lead", text: "Interested" },
      { from: "lead", text: "Tuesday works" },
    ],
    replyMessage: "Tuesday works",
  });

  assert.equal(merged.length, 4);
  assert.equal(merged[2].text, "Sent from dashboard only");
  assert.equal(merged.at(-1).text, "Tuesday works");
});

test("mergeWebhookConversation dedupes by message id and preserves atSource", () => {
  const merged = mergeWebhookConversation({
    priorEvent: null,
    priorThread: [
      { id: "m1", from: "us", text: "Hi", at: "2026-06-10T10:00:00.000Z", atSource: "heyreach_api" },
      { id: "m2", from: "lead", text: "Interested", at: "2026-06-10T11:00:00.000Z", atSource: "heyreach_api" },
    ],
    incomingThread: [
      { id: "m1", from: "us", text: "Hi (slightly different formatting)" },
      { id: "m3", from: "lead", text: "Tuesday works", at: "2026-06-10T12:00:00.000Z", atSource: "heyreach_webhook" },
    ],
  });

  // m1 should not be duplicated despite different text
  const m1Count = merged.filter((m) => m.id === "m1").length;
  assert.equal(m1Count, 1);
  // new message appended
  assert.ok(merged.find((m) => m.id === "m3"));
  // atSource preserved
  assert.equal(merged.find((m) => m.id === "m2").atSource, "heyreach_api");
  assert.equal(merged.find((m) => m.id === "m3").atSource, "heyreach_webhook");
});

test("buildConversationOnlyPatch updates thread without changing reply context", () => {
  const patch = buildConversationOnlyPatch(
    { id: "evt_old", status: "sent", lead: { replyMessage: "Old reply" } },
    [
      { from: "lead", text: "Old reply" },
      { from: "us", text: "Thanks" },
      { from: "lead", text: "New reply" },
    ],
  );

  assert.equal(patch.lead.conversation.length, 3);
  assert.equal(patch.lead.replyMessage, "Old reply");
});

test("syncAllLeadConversationEvents updates every event for a conversation", async () => {
  const updates = [];
  const events = [
    { id: "evt_new", status: "pending_review", lead: { conversationId: "c1", replyMessage: "New" } },
    { id: "evt_old", status: "sent", lead: { conversationId: "c1", replyMessage: "Old" } },
  ];
  const merged = [
    { from: "lead", text: "Old" },
    { from: "us", text: "Hi" },
    { from: "lead", text: "New" },
  ];

  const result = await syncAllLeadConversationEvents({
    conversationId: "c1",
    mergedConversation: merged,
    parsedLead: { conversationId: "c1" },
    findAllEvents: async () => events,
    updateEvent: async (id, patch) => {
      updates.push({ id, patch });
      return { id, ...patch };
    },
  });

  assert.equal(result.synced, 2);
  assert.equal(updates.length, 2);
  assert.equal(updates[0].id, "evt_new");
  assert.equal(updates[0].patch.lead.conversation.length, 3);
  assert.equal(updates[0].patch.lead.replyMessage, "New");
  assert.equal(updates[1].id, "evt_old");
  assert.equal(updates[1].patch.lead.replyMessage, "Old");
  assert.equal(updates[1].patch.lead.conversation.length, 3);
});

test("appendOurMessage adds outbound with dashboard_send metadata", () => {
  const thread = appendOurMessage(
    [{ from: "lead", text: "Hi" }],
    "Thanks for reaching out",
    "2026-06-10T12:00:00.000Z",
  );
  assert.equal(thread.length, 2);
  assert.equal(thread[1].from, "us");
  assert.equal(thread[1].atSource, "dashboard_send");
});

test("syncAllLeadConversationEvents preserves sent event reply when newest is sent", async () => {
  const updates = [];
  const events = [
    {
      id: "evt_sent",
      status: "sent",
      lead: { conversationId: "c1", replyMessage: "Interested" },
      sendResult: { reply: "Great, let's chat" },
    },
  ];
  const merged = [
    { from: "us", text: "Hi" },
    { from: "lead", text: "Interested" },
    { from: "us", text: "Great, let's chat" },
    { from: "lead", text: "Tuesday works" },
  ];

  await syncAllLeadConversationEvents({
    conversationId: "c1",
    mergedConversation: merged,
    parsedLead: { conversationId: "c1" },
    findAllEvents: async () => events,
    updateEvent: async (id, patch) => {
      updates.push({ id, patch });
      return { id, ...patch };
    },
  });

  assert.equal(updates.length, 1);
  assert.equal(updates[0].patch.lead.replyMessage, "Interested");
  assert.equal(updates[0].patch.lead.conversation.length, 4);
});

test("buildEnsuredConversationEvent creates dismissed record for synced thread", () => {
  const patch = buildEnsuredConversationEvent({
    mergedConversation: [
      { from: "us", text: "Hello" },
      { from: "lead", text: "Thanks" },
    ],
    parsedLead: {
      fullName: "Jane Doe",
      conversationId: "conv-1",
      linkedInAccountId: 99,
    },
    inbound: { latestLeadReply: "Thanks" },
  });

  assert.ok(patch);
  assert.equal(patch.status, "dismissed");
  assert.equal(patch.lead.conversation.length, 2);
  assert.equal(patch.lead.replyMessage, "Thanks");
});
