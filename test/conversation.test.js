import test from "node:test";
import assert from "node:assert/strict";
import {
  enrichDisplayThread,
  mergeConversationHistory,
  conversationFromEvent,
  evaluateInboundWebhook,
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
