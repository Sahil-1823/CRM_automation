import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  appendCalendlyLinkToReply,
  buildCalendlyScheduling,
} from "../lib/scheduling/calendly.js";
import { isCalendlySchedulingMode } from "../lib/scheduling/config.js";
import { finalizeAgentDraftResult } from "../lib/draft-pipeline.js";

describe("scheduling calendly mode", () => {
  let savedMode;

  beforeEach(() => {
    savedMode = process.env.SCHEDULING_MODE;
    process.env.SCHEDULING_MODE = "calendly";
  });

  afterEach(() => {
    if (savedMode === undefined) delete process.env.SCHEDULING_MODE;
    else process.env.SCHEDULING_MODE = savedMode;
  });

  it("defaults to calendly mode", () => {
    assert.equal(isCalendlySchedulingMode(), true);
  });

  it("appendCalendlyLinkToReply adds link once", () => {
    const link = "https://calendly.com/abhishek-llmaudit/30min";
    const once = appendCalendlyLinkToReply("Sounds good!", link);
    assert.match(once, /calendly\.com/);
    assert.equal(appendCalendlyLinkToReply(once, link), once);
  });

  it("finalizeAgentDraftResult appends calendly link to draft", () => {
    const link = "https://calendly.com/abhishek-llmaudit/30min";
    const out = finalizeAgentDraftResult({
      draft: { reply: "Happy to chat", rationale: "", ragSources: [], citedSources: [], hasGrounding: false },
      scheduling: buildCalendlyScheduling(link),
      agentTrace: [],
      draftProjectId: "all",
      project: { id: null, name: "All projects", source: "auto" },
    });
    assert.match(out.draft.reply, /calendly\.com/);
    assert.equal(out.draft.scheduling.mode, "calendly");
  });

  it("agent runner does not reference calendar tools in calendly mode", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(
      new URL("../lib/agent/runner.js", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(src, /tools\/calendar/);
  });
});
