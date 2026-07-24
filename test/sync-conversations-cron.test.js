import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  selectConversationsToSync,
  authorizeCronRequest,
} from "../lib/dashboard/sync-conversations-batch.js";

describe("sync conversations cron batch", () => {
  it("dedupes by conversationId and prefers pending", () => {
    const now = Date.parse("2026-07-24T12:00:00.000Z");
    const selected = selectConversationsToSync(
      [
        {
          id: "e1",
          channel: "heyreach",
          status: "sent",
          updatedAt: "2026-07-20T10:00:00.000Z",
          conversationSyncedAt: "2026-07-20T10:00:00.000Z",
          lead: { conversationId: "c1", linkedInAccountId: 11 },
        },
        {
          id: "e2",
          channel: "heyreach",
          status: "pending_review",
          updatedAt: "2026-07-24T11:00:00.000Z",
          conversationSyncedAt: "2026-07-20T10:00:00.000Z",
          lead: { conversationId: "c1", linkedInAccountId: 11 },
        },
        {
          id: "e3",
          channel: "heyreach",
          status: "pending_review",
          updatedAt: "2026-07-24T11:30:00.000Z",
          lead: { conversationId: "c2", linkedInAccountId: 12 },
        },
        {
          id: "g1",
          channel: "gmail",
          status: "pending_review",
          lead: { conversationId: "g-thread", linkedInAccountId: null },
        },
      ],
      { now, minSyncAgeMs: 60_000, maxPerRun: 10 },
    );

    assert.equal(selected.length, 2);
    const byId = Object.fromEntries(selected.map((s) => [s.conversationId, s]));
    assert.equal(byId.c1.eventId, "e2");
    assert.ok(byId.c2);
    assert.equal(selected.every((s) => s.priority === 0), true);
  });

  it("skips conversations synced recently", () => {
    const now = Date.parse("2026-07-24T12:00:00.000Z");
    const selected = selectConversationsToSync(
      [
        {
          id: "e1",
          channel: "heyreach",
          status: "pending_review",
          updatedAt: "2026-07-24T11:59:00.000Z",
          conversationSyncedAt: "2026-07-24T11:58:00.000Z",
          lead: { conversationId: "c1", linkedInAccountId: 1 },
        },
      ],
      { now, minSyncAgeMs: 5 * 60 * 1000, maxPerRun: 10 },
    );
    assert.equal(selected.length, 0);
  });

  it("authorizeCronRequest accepts bearer or token query", () => {
    const prev = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "secret123";
    try {
      assert.equal(
        authorizeCronRequest({
          headers: { authorization: "Bearer secret123" },
          url: "/api/cron/sync-conversations",
        }),
        true,
      );
      assert.equal(
        authorizeCronRequest({
          headers: {},
          url: "/api/cron/sync-conversations?token=secret123",
        }),
        true,
      );
      assert.equal(
        authorizeCronRequest({
          headers: {},
          url: "/api/cron/sync-conversations?token=wrong",
        }),
        false,
      );
    } finally {
      if (prev === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = prev;
    }
  });
});
