import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MAX_MESSAGES_PER_WEBHOOK } from "../lib/gmail/config.js";

describe("gmail webhook limits", () => {
  it("caps messages per webhook at 5", () => {
    assert.equal(MAX_MESSAGES_PER_WEBHOOK, 5);
  });

  it("dedupes message id list like webhook would", () => {
    const messageIds = ["a", "b", "a", "c", "d", "e", "f", "g"];
    const unique = [...new Set(messageIds)].slice(0, MAX_MESSAGES_PER_WEBHOOK);
    assert.deepEqual(unique, ["a", "b", "c", "d", "e"]);
  });
});
