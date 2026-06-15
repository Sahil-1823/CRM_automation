import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyReplySentiment } from "./sentiment.js";
import { generateDraftReply } from "./reply.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCENARIOS_PATH = path.join(__dirname, "..", "harness", "scenarios.json");

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

function wordCount(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

export async function loadScenarios() {
  const raw = await fs.readFile(SCENARIOS_PATH, "utf8");
  return JSON.parse(raw);
}

export async function getScenarioById(id) {
  const scenarios = await loadScenarios();
  return scenarios.find((s) => s.id === id) || null;
}

function buildConversation(input) {
  if (input.conversation?.length) return input.conversation;
  const thread = [];
  if (input.yourMessage) thread.push({ from: "us", text: input.yourMessage });
  if (input.replyMessage) thread.push({ from: "lead", text: input.replyMessage });
  return thread;
}

/** Run sentiment + RAG draft pipeline (same as webhook, without storage or HeyReach). */
export async function runAiPipeline(input) {
  const startedAt = Date.now();
  const conversation = buildConversation(input);

  const sentiment = await classifyReplySentiment({
    replyMessage: input.replyMessage,
    yourMessage: input.yourMessage,
    leadName: input.leadName,
    companyName: input.companyName,
  });

  const draft = await generateDraftReply({
    replyMessage: input.replyMessage,
    yourMessage: input.yourMessage,
    leadName: input.leadName,
    companyName: input.companyName,
    jobTitle: input.jobTitle,
    sentiment: sentiment.sentiment,
    isPositive: sentiment.isPositive,
    conversation,
  });

  return {
    input,
    conversation,
    sentiment,
    draft,
    durationMs: Date.now() - startedAt,
  };
}

export function evaluateResult(result, expect = {}) {
  const checks = [];
  const reply = result.draft?.reply || "";
  const words = wordCount(reply);

  if (expect.sentiment) {
    const pass = result.sentiment?.sentiment === expect.sentiment;
    checks.push({
      id: "sentiment",
      pass,
      expected: expect.sentiment,
      actual: result.sentiment?.sentiment,
      message: pass ? "Sentiment matches" : `Expected ${expect.sentiment}, got ${result.sentiment?.sentiment}`,
    });
  }

  if (expect.replyMinWords != null) {
    const pass = words >= expect.replyMinWords;
    checks.push({
      id: "replyMinWords",
      pass,
      expected: `>= ${expect.replyMinWords}`,
      actual: words,
      message: pass ? "Reply long enough" : `Reply has ${words} words, need >= ${expect.replyMinWords}`,
    });
  }

  if (expect.replyMaxWords != null) {
    const pass = words <= expect.replyMaxWords;
    checks.push({
      id: "replyMaxWords",
      pass,
      expected: `<= ${expect.replyMaxWords}`,
      actual: words,
      message: pass ? "Reply within word limit" : `Reply has ${words} words, max ${expect.replyMaxWords}`,
    });
  }

  if (expect.noEmoji !== false) {
    const pass = !EMOJI_RE.test(reply);
    checks.push({
      id: "noEmoji",
      pass,
      message: pass ? "No emojis in reply" : "Reply contains emoji",
    });
  }

  if (expect.replyNotEmpty !== false) {
    const pass = reply.trim().length > 0;
    checks.push({
      id: "replyNotEmpty",
      pass,
      message: pass ? "Draft reply generated" : "Draft reply is empty",
    });
  }

  const passed = checks.every((c) => c.pass);
  return { passed, checks };
}

export async function runScenario(scenario) {
  const result = await runAiPipeline(scenario.input);
  const evaluation = evaluateResult(result, scenario.expect || {});
  return {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    ...result,
    evaluation,
  };
}

export async function runAllScenarios() {
  const scenarios = await loadScenarios();
  const results = [];

  for (const scenario of scenarios) {
    try {
      results.push(await runScenario(scenario));
    } catch (error) {
      results.push({
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        error: error.message,
        evaluation: { passed: false, checks: [{ id: "runtime", pass: false, message: error.message }] },
      });
    }
  }

  const passed = results.filter((r) => r.evaluation?.passed).length;
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    results,
  };
}
