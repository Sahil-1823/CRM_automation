import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { matchLeadReplyToProposedSlot } from "../lib/scheduling/intent.js";

const proposedSlots = [
  {
    start: "2026-06-19T09:30:00.000Z",
    end: "2026-06-19T10:00:00.000Z",
    label: "Thu, Jun 19, 3:00 PM – 3:30 PM",
  },
  {
    start: "2026-06-20T09:30:00.000Z",
    end: "2026-06-20T10:00:00.000Z",
    label: "Fri, Jun 20, 3:00 PM – 3:30 PM",
  },
];

describe("scheduling intent matching", () => {
  it("matches option number to proposed slot", () => {
    const slot = matchLeadReplyToProposedSlot("Option 2 works for me", proposedSlots);
    assert.equal(slot?.start, proposedSlots[1].start);
  });

  it("matches day agreement to proposed slot", () => {
    const slot = matchLeadReplyToProposedSlot("Thursday works", proposedSlots);
    assert.equal(slot?.start, proposedSlots[0].start);
  });

  it("returns null when no match", () => {
    assert.equal(matchLeadReplyToProposedSlot("Maybe next week", proposedSlots), null);
  });
});
