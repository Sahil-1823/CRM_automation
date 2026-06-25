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
    const twice = appendCalendlyLinkToReply(once, TEST_LINK);
    assert.equal(once, twice);
  });

  it("appendCalendlyLinkToReply skips when calendly already in text", () => {
    const withLink = "Book here: https://calendly.com/other/30min";
    assert.equal(appendCalendlyLinkToReply(withLink, TEST_LINK), withLink);
  });
});
