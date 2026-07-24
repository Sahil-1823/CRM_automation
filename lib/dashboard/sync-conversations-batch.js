/**
 * Pick HeyReach conversations to sync in a cron batch.
 * Dedupes by conversationId, prefers pending, skips recently synced threads.
 */

function activityAt(event) {
  return (
    event?.updatedAt ||
    event?.conversationSyncedAt ||
    event?.refreshedAt ||
    event?.sentAt ||
    event?.createdAt ||
    ""
  );
}

function conversationKey(event) {
  const conversationId = event?.lead?.conversationId;
  if (!conversationId) return null;
  return String(conversationId);
}

function linkedInAccountIdFrom(event) {
  const id =
    event?.lead?.linkedInAccountId ?? event?.linkedInAccount?.linkedInAccountId ?? null;
  return id == null || id === "" ? null : id;
}

/**
 * @param {Array} events
 * @param {object} options
 * @param {number} options.now
 * @param {number} options.minSyncAgeMs - skip if synced more recently than this
 * @param {number} options.recentActivityMs - include non-pending if active within this window
 * @param {number} options.maxPerRun
 */
export function selectConversationsToSync(
  events,
  {
    now = Date.now(),
    minSyncAgeMs = 4 * 60 * 1000,
    recentActivityMs = 14 * 24 * 60 * 60 * 1000,
    maxPerRun = 20,
  } = {},
) {
  const byConv = new Map();

  for (const event of events || []) {
    if ((event.channel || "heyreach") !== "heyreach") continue;
    const conversationId = conversationKey(event);
    const linkedInAccountId = linkedInAccountIdFrom(event);
    if (!conversationId || linkedInAccountId == null) continue;

    const existing = byConv.get(conversationId);
    const score = new Date(activityAt(event) || 0).getTime();
    const existingScore = existing ? new Date(activityAt(existing) || 0).getTime() : -1;
    if (!existing || score >= existingScore) {
      byConv.set(conversationId, event);
    }
  }

  const candidates = [];
  for (const event of byConv.values()) {
    const syncedAt = event.conversationSyncedAt
      ? new Date(event.conversationSyncedAt).getTime()
      : 0;
    if (syncedAt && now - syncedAt < minSyncAgeMs) continue;

    const isPending = event.status === "pending_review";
    const activity = new Date(activityAt(event) || 0).getTime();
    const isRecent = activity && now - activity <= recentActivityMs;
    if (!isPending && !isRecent) continue;

    candidates.push({
      eventId: event.id,
      conversationId: conversationKey(event),
      linkedInAccountId: linkedInAccountIdFrom(event),
      status: event.status,
      priority: isPending ? 0 : 1,
      lastSyncedAt: syncedAt || 0,
      activityAt: activity || 0,
    });
  }

  candidates.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.lastSyncedAt !== b.lastSyncedAt) return a.lastSyncedAt - b.lastSyncedAt;
    return b.activityAt - a.activityAt;
  });

  return candidates.slice(0, Math.max(0, maxPerRun));
}

/** Authorize Vercel cron (Bearer) or legacy ?token= query. */
export function authorizeCronRequest(req) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return true;

  const auth = req.headers?.authorization || req.headers?.Authorization || "";
  if (auth === `Bearer ${cronSecret}`) return true;

  try {
    const url = new URL(req.url || "/", "http://localhost");
    if (url.searchParams.get("token") === cronSecret) return true;
  } catch {
    /* ignore */
  }
  return false;
}
