import { jsonResponse } from "../../lib/http.js";
import { listEvents } from "../../lib/store.js";
import { syncHeyReachConversationByEventId } from "../../lib/dashboard/sync-conversation-core.js";
import {
  selectConversationsToSync,
  authorizeCronRequest,
} from "../../lib/dashboard/sync-conversations-batch.js";
import { log } from "../../lib/infra.js";

const MAX_PER_RUN = Number(process.env.SYNC_CONVERSATIONS_CRON_LIMIT || 20);
const MIN_SYNC_AGE_MS = Number(process.env.SYNC_CONVERSATIONS_MIN_AGE_MS || 4 * 60 * 1000);

/**
 * Sync pending + recently active HeyReach conversations in batches.
 *
 * Hobby/free Vercel only allows daily native crons. Call this every ~5 minutes via
 * GitHub Actions (see .github/workflows/sync-conversations.yml) or another scheduler.
 * Not registered in vercel.json crons.
 *
 * Auth: Authorization: Bearer CRON_SECRET
 *   or: GET/POST ?token=CRON_SECRET
 */
export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return jsonResponse(res, 405, { error: "Method not allowed" });
  }

  if (!authorizeCronRequest(req)) {
    return jsonResponse(res, 401, { error: "Unauthorized" });
  }

  const startedAt = Date.now();

  try {
    const events = await listEvents({ limit: 500, channel: "heyreach" });
    const candidates = selectConversationsToSync(events, {
      now: Date.now(),
      minSyncAgeMs: MIN_SYNC_AGE_MS,
      maxPerRun: MAX_PER_RUN,
    });

    const results = [];
    let synced = 0;
    let failed = 0;
    let skipped = 0;

    for (const candidate of candidates) {
      try {
        const result = await syncHeyReachConversationByEventId(candidate.eventId);
        if (result?.synced) {
          synced += 1;
          results.push({
            conversationId: candidate.conversationId,
            eventId: candidate.eventId,
            ok: true,
            messages: result.messages,
          });
        } else {
          skipped += 1;
          results.push({
            conversationId: candidate.conversationId,
            eventId: candidate.eventId,
            ok: true,
            skipped: true,
          });
        }
      } catch (err) {
        failed += 1;
        results.push({
          conversationId: candidate.conversationId,
          eventId: candidate.eventId,
          ok: false,
          error: err.message,
        });
        log("warn", "cron.sync_conversation_failed", {
          conversationId: candidate.conversationId,
          eventId: candidate.eventId,
          error: err.message,
        });
      }
    }

    const payload = {
      ok: true,
      candidates: candidates.length,
      synced,
      skipped,
      failed,
      ms: Date.now() - startedAt,
      results,
    };

    log("info", "cron.sync_conversations", {
      candidates: candidates.length,
      synced,
      skipped,
      failed,
      ms: payload.ms,
    });

    return jsonResponse(res, 200, payload);
  } catch (error) {
    console.error("sync-conversations cron error:", error);
    log("error", "cron.sync_conversations_error", { error: error.message });
    return jsonResponse(res, 500, { error: "Failed to sync conversations" });
  }
}
