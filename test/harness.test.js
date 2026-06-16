import test from "node:test";
import assert from "node:assert/strict";
import { evaluateResult } from "../lib/harness.js";

test("evaluateResult passes when expectations match", () => {
  const result = {
    sentiment: { sentiment: "positive", isPositive: true },
    draft: { reply: "Great to hear — how does Thursday at 2pm work for a quick call?" },
  };
  const evaluation = evaluateResult(result, {
    sentiment: "positive",
    replyMinWords: 8,
    replyMaxWords: 80,
    noEmoji: true,
  });
  assert.equal(evaluation.passed, true);
  assert.ok(evaluation.checks.every((c) => c.pass));
});

test("evaluateResult fails on sentiment mismatch", () => {
  const result = {
    sentiment: { sentiment: "negative" },
    draft: { reply: "Understood, thanks for letting me know." },
  };
  const evaluation = evaluateResult(result, { sentiment: "positive" });
  assert.equal(evaluation.passed, false);
  assert.ok(evaluation.checks.some((c) => c.id === "sentiment" && !c.pass));
});

test("evaluateResult flags emoji in reply", () => {
  const result = {
    sentiment: { sentiment: "positive" },
    draft: { reply: "Sounds great! 👍" },
  };
  const evaluation = evaluateResult(result, { noEmoji: true });
  assert.equal(evaluation.passed, false);
  assert.ok(evaluation.checks.some((c) => c.id === "noEmoji" && !c.pass));
});
