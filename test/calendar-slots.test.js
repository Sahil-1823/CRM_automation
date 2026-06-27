import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  findOpenSlots,
  slotOverlapsBusy,
  slotFitsRequest,
  formatSlotLabel,
  extractMeetLink,
} from "../lib/scheduling/slots.js";

describe("calendar slots", () => {
  it("detects overlap with busy periods", () => {
    const slot = { start: "2026-06-20T10:00:00.000Z", end: "2026-06-20T10:30:00.000Z" };
    const busy = [{ start: "2026-06-20T10:15:00.000Z", end: "2026-06-20T11:00:00.000Z" }];
    assert.equal(slotOverlapsBusy(slot, busy), true);
    assert.equal(slotOverlapsBusy({ start: "2026-06-20T11:00:00.000Z", end: "2026-06-20T11:30:00.000Z" }, busy), false);
  });

  it("finds open slots skipping busy blocks", () => {
    const from = new Date("2030-06-20T04:30:00.000Z");
    const to = new Date("2030-06-21T04:30:00.000Z");
    const busy = [
      { start: "2030-06-20T04:30:00.000Z", end: "2030-06-20T05:30:00.000Z" },
    ];
    const slots = findOpenSlots({
      from,
      to,
      durationMin: 30,
      busy,
      timeZone: "Asia/Kolkata",
      workStartHour: 10,
      workEndHour: 18,
      maxSlots: 3,
    });
    assert.ok(slots.length >= 1);
    for (const slot of slots) {
      assert.equal(slotOverlapsBusy(slot, busy), false);
    }
  });

  it("slotFitsRequest matches contained slot", () => {
    const requested = { start: "2026-06-20T10:00:00.000Z", end: "2026-06-20T10:30:00.000Z" };
    const slots = [{ start: "2026-06-20T10:00:00.000Z", end: "2026-06-20T11:00:00.000Z" }];
    assert.equal(slotFitsRequest(requested, slots), true);
  });

  it("formatSlotLabel returns readable text", () => {
    const label = formatSlotLabel(
      new Date("2026-06-20T10:00:00.000Z"),
      new Date("2026-06-20T10:30:00.000Z"),
      "UTC",
    );
    assert.match(label, /Jun/);
  });

  it("extractMeetLink reads hangoutLink and conference entry points", () => {
    assert.equal(
      extractMeetLink({ hangoutLink: "https://meet.google.com/abc-defg-hij" }),
      "https://meet.google.com/abc-defg-hij",
    );
    assert.equal(
      extractMeetLink({
        conferenceData: {
          entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/xyz" }],
        },
      }),
      "https://meet.google.com/xyz",
    );
    assert.equal(extractMeetLink(null), null);
  });
});
