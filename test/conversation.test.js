import test from "node:test";
import assert from "node:assert/strict";
import {
  enrichDisplayThread,
  mergeConversationHistory,
  conversationFromEvent,
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
    sendResult: { reply: "Thanks, talk soon." },
    lead: {
      conversation: [
        { from: "us", text: "Hello" },
        { from: "lead", text: "Interested" },
      ],
    },
  });

  assert.ok(thread.some((m) => m.from === "us" && m.text === "Thanks, talk soon."));
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
