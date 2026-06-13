import test from "node:test";
import assert from "node:assert/strict";
import { getReminderDay } from "../lib/crm/index.js";
import { parseHeyReachPayload } from "../lib/heyreach.js";

test("getReminderDay maps day windows", () => {
  assert.equal(getReminderDay(1), null);
  assert.equal(getReminderDay(2), 3);
  assert.equal(getReminderDay(3), 3);
  assert.equal(getReminderDay(4), 3);
  assert.equal(getReminderDay(5), null);
  assert.equal(getReminderDay(6), 7);
  assert.equal(getReminderDay(8), 7);
  assert.equal(getReminderDay(13), 14);
  assert.equal(getReminderDay(15), 14);
  assert.equal(getReminderDay(16), null);
});

test("parseHeyReachPayload accepts common HeyReach shapes", () => {
  const parsed = parseHeyReachPayload({
    lead: {
      firstName: "Jane",
      lastName: "Doe",
      profileUrl: "https://linkedin.com/in/janedoe/",
      companyName: "Acme Inc",
      position: "VP Sales",
    },
    message: "Sounds good, let's chat next week.",
    yourMessage: "Would you be open to a quick call?",
    eventType: "MESSAGE_REPLY_RECEIVED",
  });

  assert.equal(parsed.valid, true);
  assert.equal(parsed.lead.fullName, "Jane Doe");
  assert.equal(parsed.lead.linkedInUrl, "https://linkedin.com/in/janedoe");
  assert.equal(parsed.lead.companyName, "Acme Inc");
});
