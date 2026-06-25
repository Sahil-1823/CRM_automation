import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTriage } from "../lib/sentiment.js";
import { shouldAutoSend } from "../lib/draft-pipeline.js";

test("normalizeTriage marks action_required as needs human", () => {
  const result = normalizeTriage({
    sentiment: "positive",
    reasoning: "Lead shared application link",
    category: "action_required",
    handling: "needs_human",
    actionItems: ["Apply at careers.example.com/jobs/123"],
    handlingReason: "Lead asks us to submit an application outside chat",
  });

  assert.equal(result.requiresHuman, true);
  assert.equal(result.category, "action_required");
  assert.equal(result.actionItems.length, 1);
  assert.equal(result.isPositive, true);
});

test("normalizeTriage allows conversational replies", () => {
  const result = normalizeTriage({
    sentiment: "positive",
    reasoning: "Interested in a call",
    category: "conversational",
    handling: "auto_ok",
    actionItems: [],
    handlingReason: "Normal scheduling interest",
  });

  assert.equal(result.requiresHuman, false);
  assert.equal(result.category, "conversational");
});

test("normalizeTriage allows info_request replies", () => {
  const result = normalizeTriage({
    sentiment: "neutral",
    reasoning: "Asking about product",
    category: "info_request",
    handling: "auto_ok",
    actionItems: [],
    handlingReason: "Answerable in chat",
  });

  assert.equal(result.requiresHuman, false);
});

test("normalizeTriage marks sensitive and unsubscribe as needs human", () => {
  const sensitive = normalizeTriage({
    sentiment: "neutral",
    reasoning: "Pricing question",
    category: "sensitive",
    handling: "needs_human",
    actionItems: [],
    handlingReason: "Pricing negotiation",
  });
  assert.equal(sensitive.requiresHuman, true);

  const unsub = normalizeTriage({
    sentiment: "negative",
    reasoning: "Not interested",
    category: "unsubscribe",
    handling: "needs_human",
    actionItems: [],
    handlingReason: "Lead asked to stop",
  });
  assert.equal(unsub.requiresHuman, true);
});

test("normalizeTriage fail-safes on missing or garbage input", () => {
  const missing = normalizeTriage(null);
  assert.equal(missing.requiresHuman, true);
  assert.equal(missing.category, "unclear");

  const mismatch = normalizeTriage({
    sentiment: "positive",
    reasoning: "ok",
    category: "conversational",
    handling: "needs_human",
    actionItems: [],
    handlingReason: "Model said needs human",
  });
  assert.equal(mismatch.requiresHuman, true);
});

test("shouldAutoSend blocks when handling requires human", () => {
  const result = shouldAutoSend({
    handling: { requiresHuman: true, reason: "Apply at link" },
    sentiment: { label: "positive" },
    draft: { reply: "Sounds good!", skipped: false },
  });
  assert.equal(result.allowed, false);
});

test("shouldAutoSend blocks negative sentiment", () => {
  const result = shouldAutoSend({
    handling: { requiresHuman: false },
    sentiment: { label: "negative" },
    draft: { reply: "Thanks anyway", skipped: false },
  });
  assert.equal(result.allowed, false);
});

test("shouldAutoSend blocks skipped or empty draft", () => {
  assert.equal(
    shouldAutoSend({
      handling: { requiresHuman: false },
      sentiment: { label: "positive" },
      draft: { reply: "", skipped: true },
    }).allowed,
    false,
  );
  assert.equal(
    shouldAutoSend({
      handling: { requiresHuman: false },
      sentiment: { label: "positive" },
      draft: { reply: "  ", skipped: false },
    }).allowed,
    false,
  );
});

test("shouldAutoSend allows clean positive draft", () => {
  const result = shouldAutoSend({
    handling: { requiresHuman: false },
    sentiment: { label: "positive", isPositive: true },
    draft: { reply: "Tuesday works — I'll send a calendar invite.", skipped: false },
  });
  assert.equal(result.allowed, true);
});

test("normalizeTriage allows scheduling replies", () => {
  const result = normalizeTriage({
    sentiment: "positive",
    reasoning: "Wants a call Tuesday",
    category: "scheduling",
    handling: "auto_ok",
    actionItems: [],
    handlingReason: "Meeting request",
  });

  assert.equal(result.requiresHuman, false);
  assert.equal(result.category, "scheduling");
  assert.equal(result.schedulingIntent, true);
});

test("serializeEvent exposes draft.scheduling", async () => {
  const { serializeEvent } = await import("../lib/store.js");
  const out = serializeEvent({
    id: "evt2",
    status: "pending_review",
    createdAt: "2026-06-18T12:00:00.000Z",
    lead: { fullName: "Jane Doe", conversation: [] },
    draft: {
      reply: "Thursday works",
      scheduling: {
        intent: true,
        status: "ready_to_book",
        requestedTime: "2026-06-20T09:30:00.000Z",
        proposedSlots: [],
        pendingBook: {
          start: "2026-06-20T09:30:00.000Z",
          end: "2026-06-20T10:00:00.000Z",
          title: "Call with Jane",
          label: "Fri 3pm",
        },
        calendarEventId: null,
      },
      agentTrace: [{ tool: "checkAvailability", result: { available: true } }],
    },
    sentiment: { label: "positive" },
  });
  assert.equal(out.draft.scheduling.status, "ready_to_book");
  assert.equal(out.draft.scheduling.pendingBook.title, "Call with Jane");
  assert.equal(out.draft.agentTrace.length, 1);
});

test("serializeEvent exposes auto_resolved metadata", async () => {
  const { serializeEvent } = await import("../lib/store.js");
  const out = serializeEvent({
    id: "evt1",
    status: "auto_resolved",
    createdAt: "2026-06-18T12:00:00.000Z",
    autoResolvedAt: "2026-06-18T12:05:00.000Z",
    autoResolvedReason: "Reply already exists in HeyReach thread",
    lead: { fullName: "Jane Doe", conversation: [] },
    draft: { reply: "", skipped: true },
    sentiment: { label: "neutral" },
  });
  assert.equal(out.status, "auto_resolved");
  assert.equal(out.autoResolvedReason, "Reply already exists in HeyReach thread");
  assert.equal(out.autoResolvedAt, "2026-06-18T12:05:00.000Z");
});
