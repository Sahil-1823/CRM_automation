import { jsonResponse } from "../../http.js";
import { requireAuth } from "../../auth.js";
import { listEvents } from "../../store.js";
import { getHeyReachMeta } from "../heyreach/meta.js";

function collectFromEvents(events) {
  const accountMap = new Map();
  const campaignMap = new Map();

  for (const e of events) {
    const accountId = e.lead?.linkedInAccountId ?? e.linkedInAccount?.linkedInAccountId;
    const accountName = e.linkedInAccount?.name;
    if (accountId != null && accountName) {
      accountMap.set(Number(accountId), accountName);
    }

    const campaignId = e.campaign?.id ?? e.lead?.campaignId;
    const campaignName = e.campaign?.name ?? e.lead?.campaignName;
    if (campaignId != null || campaignName) {
      const key = campaignId != null ? `id:${campaignId}` : `name:${campaignName}`;
      campaignMap.set(key, {
        id: campaignId != null ? Number(campaignId) : null,
        name: campaignName || (campaignId != null ? `Campaign ${campaignId}` : "Unnamed campaign"),
      });
    }
  }

  return {
    accounts: [...accountMap.entries()].map(([id, name]) => ({ id, name })),
    campaigns: [...campaignMap.values()],
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return jsonResponse(res, 405, { error: "Method not allowed" });
  }

  try {
    if (!(await requireAuth(req, res))) return;

    const events = await listEvents({ limit: 500 });
    const fromEvents = collectFromEvents(events);
    const meta = await getHeyReachMeta(fromEvents.accounts, fromEvents.campaigns);

    return jsonResponse(res, 200, meta);
  } catch (error) {
    console.error("heyreach-meta api error:", error);
    return jsonResponse(res, 500, { error: "Failed to load HeyReach metadata" });
  }
}
