import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  appendBookingLinkToReply,
  buildHeyReachBookingScheduling,
} from "../lib/scheduling/booking-link.js";
import { finalizeAgentDraftResult } from "../lib/draft-pipeline.js";

const HEYREACH_LINK = "https://meet.example.com/qynte-30min";

describe("scheduling heyreach booking link", () => {
  let savedLink;

  beforeEach(() => {
    savedLink = process.env.HEYREACH_BOOKING_LINK;
    process.env.HEYREACH_BOOKING_LINK = HEYREACH_LINK;
  });

  afterEach(() => {
    if (savedLink === undefined) delete process.env.HEYREACH_BOOKING_LINK;
    else process.env.HEYREACH_BOOKING_LINK = savedLink;
  });

  it("buildHeyReachBookingScheduling uses HEYREACH_BOOKING_LINK", () => {
    const s = buildHeyReachBookingScheduling();
    assert.equal(s.mode, "booking_link");
    assert.equal(s.channel, "heyreach");
    assert.equal(s.bookingLink, HEYREACH_LINK);
  });

  it("appendBookingLinkToReply adds link once", () => {
    const once = appendBookingLinkToReply("Happy to chat!", HEYREACH_LINK);
    assert.match(once, /Grab a time that works:/);
    assert.match(once, /meet\.example\.com/);
    assert.equal(appendBookingLinkToReply(once, HEYREACH_LINK), once);
  });

  it("finalizeAgentDraftResult appends heyreach link for heyreach channel", () => {
    const out = finalizeAgentDraftResult({
      draft: { reply: "Let's connect", rationale: "", ragSources: [], citedSources: [], hasGrounding: false },
      scheduling: buildHeyReachBookingScheduling(HEYREACH_LINK),
      agentTrace: [],
      draftProjectId: "all",
      project: { id: null, name: "All projects", source: "auto" },
    }, { channel: "heyreach" });
    assert.match(out.draft.reply, /meet\.example\.com/);
    assert.doesNotMatch(out.draft.reply, /calendly\.com/);
  });

  it("finalizeAgentDraftResult does not append heyreach link for gmail channel", () => {
    const out = finalizeAgentDraftResult({
      draft: { reply: "Let's connect", rationale: "", ragSources: [], citedSources: [], hasGrounding: false },
      scheduling: buildHeyReachBookingScheduling(HEYREACH_LINK),
      agentTrace: [],
      draftProjectId: "all",
      project: { id: null, name: "All projects", source: "auto" },
    }, { channel: "gmail" });
    assert.doesNotMatch(out.draft.reply, /meet\.example\.com/);
  });
});
