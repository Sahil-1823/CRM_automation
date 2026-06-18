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
