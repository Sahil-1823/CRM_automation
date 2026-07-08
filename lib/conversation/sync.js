import {
  fetchHeyReachChatroom,
  mergeIncomingThreads,
} from "../heyreach/client.js";
import {
  readChatroomCache,
  writeChatroomCache,
  invalidateChatroomCache,
  log,
} from "../infra.js";

/**
 * Fetch HeyReach inbox thread and merge with webhook/local thread.
 * Always prefers API history when available (cached 60s unless forceRefresh).
 */
export async function fetchEnrichedIncomingThread({
  conversationId,
  linkedInAccountId,
  webhookThread = [],
  forceRefresh = false,
  apiKey,
}) {
  if (!conversationId || !linkedInAccountId) {
    return webhookThread || [];
  }

  if (!forceRefresh) {
    const cached = await readChatroomCache(conversationId, linkedInAccountId);
    if (cached?.length) {
      return mergeIncomingThreads(webhookThread, cached);
    }
  }

  try {
    const t0 = Date.now();
    const apiThread = await fetchHeyReachChatroom({
      conversationId,
      linkedInAccountId,
      timeoutMs: 4000,
      apiKey,
    });
    log("info", "chatroom.fetched", {
      conversationId,
      size: apiThread.length,
      ms: Date.now() - t0,
      forceRefresh,
    });
    if (apiThread.length) {
      await writeChatroomCache(conversationId, linkedInAccountId, apiThread);
    }
    return mergeIncomingThreads(webhookThread, apiThread);
  } catch (err) {
    log("warn", "chatroom.fetch_failed", { conversationId, error: err.message });
    return webhookThread || [];
  }
}

export { invalidateChatroomCache };
