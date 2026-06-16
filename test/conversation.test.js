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

test("conversationFromEvent includes sent message after send", () => {
  const thread = conversationFromEvent({
    status: "sent",
    sendResult: { reply: "Thanks, talk soon." },
    lead: {
      yourMessage: "Quick intro",
      replyMessage: "Sounds good",
      conversation: [{ from: "lead", text: "Sounds good" }],
    },
  });

  assert.ok(thread.some((m) => m.from === "us" && m.text === "Thanks, talk soon."));
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
