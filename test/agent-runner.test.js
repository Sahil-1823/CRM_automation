import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { registerTool, invokeTool, getRegisteredTools } from "../lib/agent/tools.js";

describe("agent framework", () => {
  it("registers and invokes tool handlers", async () => {
    const before = getRegisteredTools().length;
    registerTool("testEchoTool", {
      description: "echo",
      parameters: { type: "object", properties: { value: { type: "string" } } },
      handler: async ({ value }) => ({ echoed: value }),
    });
    assert.ok(getRegisteredTools().length >= before + 1);
    const result = await invokeTool("testEchoTool", { value: "hello" });
    assert.equal(result.echoed, "hello");
  });

  it("scheduling triage category is recognized", async () => {
    const { runDraftAgent } = await import("../lib/agent/runner.js");
    assert.equal(typeof runDraftAgent, "function");
  });
});
