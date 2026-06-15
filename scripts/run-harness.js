#!/usr/bin/env node
/**
 * CLI for the AI harness. Requires OPENAI_API_KEY in env.
 *
 *   npm run harness          # run all scenarios
 *   npm run harness -- --id positive-schedule-call
 */

import { runAllScenarios, runScenario, getScenarioById } from "../lib/harness.js";

const idArg = process.argv.find((a) => a.startsWith("--id="))?.slice(5)
  || (process.argv.includes("--id") ? process.argv[process.argv.indexOf("--id") + 1] : null);

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY is required for live harness runs.");
    process.exit(1);
  }

  if (idArg) {
    const scenario = await getScenarioById(idArg);
    if (!scenario) {
      console.error(`Scenario not found: ${idArg}`);
      process.exit(1);
    }
    const result = await runScenario(scenario);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.evaluation.passed ? 0 : 1);
  }

  const report = await runAllScenarios();
  console.log(`\nAI Harness: ${report.passed}/${report.total} passed\n`);

  for (const r of report.results) {
    const icon = r.evaluation?.passed ? "✓" : "✗";
    console.log(`${icon} ${r.scenarioName} (${r.durationMs ?? 0}ms)`);
    if (!r.evaluation?.passed) {
      for (const check of r.evaluation?.checks || []) {
        if (!check.pass) console.log(`    - ${check.message}`);
      }
      if (r.error) console.log(`    - ${r.error}`);
    }
  }

  process.exit(report.failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
