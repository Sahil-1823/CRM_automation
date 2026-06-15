import { jsonResponse, readJsonBody } from "../lib/http.js";
import { requireAuth } from "../lib/auth.js";
import {
  loadScenarios,
  getScenarioById,
  runAiPipeline,
  runScenario,
  runAllScenarios,
  evaluateResult,
} from "../lib/harness.js";

export default async function handler(req, res) {
  try {
    if (!(await requireAuth(req, res))) return;

    const url = new URL(req.url, "http://localhost");
    const action = url.searchParams.get("action") || "scenarios";

    if (req.method === "GET" && action === "scenarios") {
      const scenarios = await loadScenarios();
      return jsonResponse(res, 200, {
        scenarios: scenarios.map((s) => ({
          id: s.id,
          name: s.name,
          input: s.input,
          expect: s.expect,
        })),
      });
    }

    if (req.method === "POST" && action === "run") {
      const body = await readJsonBody(req);

      if (body.scenarioId) {
        const scenario = await getScenarioById(body.scenarioId);
        if (!scenario) {
          return jsonResponse(res, 404, { error: "Scenario not found" });
        }
        const result = await runScenario(scenario);
        return jsonResponse(res, 200, result);
      }

      if (!body.replyMessage?.trim()) {
        return jsonResponse(res, 400, { error: "replyMessage is required" });
      }

      const input = {
        leadName: body.leadName || "Test Lead",
        companyName: body.companyName || "",
        jobTitle: body.jobTitle || "",
        yourMessage: body.yourMessage || "",
        replyMessage: body.replyMessage,
        conversation: body.conversation,
      };

      const result = await runAiPipeline(input);
      const evaluation = body.expect
        ? evaluateResult(result, body.expect)
        : evaluateResult(result, { replyNotEmpty: true, replyMaxWords: 80, noEmoji: true });

      return jsonResponse(res, 200, { ...result, evaluation });
    }

    if (req.method === "POST" && action === "eval") {
      const report = await runAllScenarios();
      return jsonResponse(res, 200, report);
    }

    return jsonResponse(res, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error("harness api error:", error);
    return jsonResponse(res, 500, {
      error: "Harness failed",
      message: error.message,
    });
  }
}
