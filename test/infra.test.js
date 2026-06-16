import test from "node:test";
import assert from "node:assert/strict";
import {
  buildIdempotencyKey,
  claimIdempotencyKey,
  readChatroomCache,
  writeChatroomCache,
  archiveRawWebhook,
} from "../lib/infra.js";

test("buildIdempotencyKey is stable for same input and unique per text", () => {
  const a = buildIdempotencyKey({
    conversationId: "c1",
    eventType: "every_message_reply_received",
    latestText: "Hello",
  });
  const b = buildIdempotencyKey({
    conversationId: "c1",
    eventType: "every_message_reply_received",
    latestText: "Hello",
  });
  const c = buildIdempotencyKey({
    conversationId: "c1",
    eventType: "every_message_reply_received",
    latestText: "Hello!",
  });
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("buildIdempotencyKey falls back to body hash when conversationId missing", () => {
  const key = buildIdempotencyKey({ fallbackBody: "{abc}" });
  assert.match(key, /^raw:/);
});

test("claimIdempotencyKey returns true when Redis is unavailable (best-effort)", async () => {
  const result = await claimIdempotencyKey("test-key");
  assert.equal(result, true);
});

test("chatroom cache no-ops cleanly without Redis", async () => {
  await writeChatroomCache("c1", "a1", [{ from: "lead", text: "hi" }]);
  const v = await readChatroomCache("c1", "a1");
  assert.equal(v, null);
});

test("archiveRawWebhook returns an id even without Redis", async () => {
  const id = await archiveRawWebhook({ ok: true });
  assert.equal(typeof id, "string");
  assert.ok(id.length > 0);
});
