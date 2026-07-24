import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  appendBookingLinkToReply,
  buildHeyReachBookingScheduling,
  conversationHasBookingOffer,
} from "../lib/scheduling/booking-link.js";
import { finalizeAgentDraftResult } from "../lib/draft-pipeline.js";

const HEYREACH_LINK = "https://meet.example.com/qynte-30min";
const GOOGLE_CAL_LINK = "https://calendar.app.google/NYjXa1NUGj8Wyxm99";

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
    assert.equal(s.appendLink, true);
    assert.equal(s.alreadyOffered, false);
  });

  it("buildHeyReachBookingScheduling detects link already in thread", () => {
    const s = buildHeyReachBookingScheduling(HEYREACH_LINK, {
      conversation: [
        { from: "lead", text: "Let's meet" },
        { from: "us", text: `Grab a time: ${HEYREACH_LINK}` },
      ],
    });
    assert.equal(s.alreadyOffered, true);
    assert.equal(s.appendLink, false);
    assert.equal(s.waitingOnLead, true);
    assert.equal(s.status, "booking_link_already_in_thread");
  });

  it("conversationHasBookingOffer detects Google Calendar links from us", () => {
    assert.equal(
      conversationHasBookingOffer(
        [
          { from: "lead", text: "Demo please" },
          { from: "us", text: `Or grab a time: ${GOOGLE_CAL_LINK}` },
        ],
        HEYREACH_LINK,
      ),
      true,
    );
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

  it("finalizeAgentDraftResult does not re-append when link already in conversation", () => {
    const conversation = [
      { from: "lead", text: "Want a demo" },
      { from: "us", text: `Grab a time that works: ${HEYREACH_LINK}` },
    ];
    const out = finalizeAgentDraftResult({
      draft: { reply: "Looking forward to it", rationale: "", ragSources: [], citedSources: [], hasGrounding: false },
      scheduling: buildHeyReachBookingScheduling(HEYREACH_LINK, { conversation }),
      agentTrace: [],
      draftProjectId: "all",
      project: { id: null, name: "All projects", source: "auto" },
    }, { channel: "heyreach", conversation });
    assert.equal(out.draft.reply, "Looking forward to it");
    assert.doesNotMatch(out.draft.reply, /meet\.example\.com/);
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
