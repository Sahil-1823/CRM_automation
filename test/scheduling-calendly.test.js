import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  appendCalendlyLinkToReply,
  buildCalendlyScheduling,
} from "../lib/scheduling/calendly.js";
import {
  getSchedulingConfig,
  isCalendlySchedulingMode,
  normalizeCalendlyLink,
} from "../lib/scheduling/config.js";
import { finalizeAgentDraftResult } from "../lib/draft-pipeline.js";

const TEST_LINK = "https://calendly.com/abhishek-llmaudit/30min";

describe("scheduling calendly mode", () => {
  let savedMode;
  let savedLink;

  beforeEach(() => {
    savedMode = process.env.SCHEDULING_MODE;
    savedLink = process.env.CALENDLY_LINK;
    process.env.SCHEDULING_MODE = "calendly";
    process.env.CALENDLY_LINK = TEST_LINK;
  });

  afterEach(() => {
    if (savedMode === undefined) delete process.env.SCHEDULING_MODE;
    else process.env.SCHEDULING_MODE = savedMode;
    if (savedLink === undefined) delete process.env.CALENDLY_LINK;
    else process.env.CALENDLY_LINK = savedLink;
  });

  it("defaults to calendly mode", () => {
    assert.equal(isCalendlySchedulingMode(), true);
    assert.equal(getSchedulingConfig().mode, "calendly");
  });

  it("normalizes calendly URL", () => {
    assert.equal(
      normalizeCalendlyLink("https://calendly.com/abhishek-llmaudit/30min?month"),
      TEST_LINK,
    );
  });

  it("buildCalendlyScheduling returns calendly shape without pendingBook", () => {
    const s = buildCalendlyScheduling();
    assert.equal(s.mode, "calendly");
    assert.equal(s.status, "calendly_link_sent");
    assert.equal(s.calendlyLink, TEST_LINK);
    assert.equal(s.pendingBook, null);
  });

  it("appendCalendlyLinkToReply adds link once", () => {
    const once = appendCalendlyLinkToReply("Happy to chat!", TEST_LINK);
    assert.match(once, /Grab a time that works:/);
    assert.match(once, /calendly\.com/);
    assert.equal(appendCalendlyLinkToReply(once, TEST_LINK), once);
  });

  it("appendCalendlyLinkToReply skips when calendly already in text", () => {
    const withLink = "Book here: https://calendly.com/other/30min";
    assert.equal(appendCalendlyLinkToReply(withLink, TEST_LINK), withLink);
  });

  it("finalizeAgentDraftResult appends calendly link to draft", () => {
    const out = finalizeAgentDraftResult({
      draft: { reply: "Happy to chat", rationale: "", ragSources: [], citedSources: [], hasGrounding: false },
      scheduling: buildCalendlyScheduling(TEST_LINK),
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
