import { jsonResponse } from "../http.js";
import { requireAuth } from "../auth.js";
import { listEvents, isUsingRedis } from "../store.js";

function increment(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function topEntries(map, limit = 5) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return jsonResponse(res, 405, { error: "Method not allowed" });
  }

  try {
    if (!(await requireAuth(req, res))) return;

    const events = await listEvents({ limit: 500 });
    const byStatus = new Map();
    const byChannel = new Map();
    const byCampaign = new Map();
    const byAccount = new Map();
    const heyreachLeadIds = new Set();
    const gmailThreadIds = new Set();
    const sentReplies = { heyreach: 0, gmail: 0 };
    let needsHuman = 0;
    let autoResolved = 0;
    let pendingReview = 0;

    for (const event of events) {
      const channel = event.channel || "heyreach";
      increment(byChannel, channel);
      increment(byStatus, event.status || "unknown");

      if (event.status === "pending_review") pendingReview += 1;
      if (event.status === "auto_resolved") autoResolved += 1;
      if (event.handling?.requiresHuman) needsHuman += 1;

      if (channel === "heyreach") {
        const conversationId = event.lead?.conversationId;
        if (conversationId != null) heyreachLeadIds.add(String(conversationId));
        const campaignName = event.campaign?.name || event.lead?.campaignName;
        if (campaignName) increment(byCampaign, campaignName);
        const accountName = event.linkedInAccount?.name || event.lead?.linkedInAccountName;
        if (accountName) increment(byAccount, accountName);
      }

      if (channel === "gmail") {
        const threadId = event.gmail?.threadId;
        if (threadId) gmailThreadIds.add(String(threadId));
      }

      if (event.status === "sent" || event.sentAt || event.sendResult?.sentAt) {
        if (channel === "gmail") sentReplies.gmail += 1;
        else sentReplies.heyreach += 1;
      }
    }

    return jsonResponse(res, 200, {
      storage: isUsingRedis() ? "redis" : "file",
      totals: {
        trackedEvents: events.length,
        trackedHeyReachLeads: heyreachLeadIds.size,
        trackedGmailThreads: gmailThreadIds.size,
        pendingReview,
        needsHuman,
        autoResolved,
        sentReplies: sentReplies.heyreach + sentReplies.gmail,
        sentHeyReachReplies: sentReplies.heyreach,
        sentGmailReplies: sentReplies.gmail,
      },
      breakdowns: {
        byStatus: topEntries(byStatus, 10),
        byChannel: topEntries(byChannel, 10),
        topCampaigns: topEntries(byCampaign, 5),
        topAccounts: topEntries(byAccount, 5),
      },
      note: "Analytics are based on the latest 500 stored events in this dashboard.",
    });
  } catch (error) {
    console.error("analytics api error:", error);
    return jsonResponse(res, 500, { error: "Failed to load analytics" });
  }
}
