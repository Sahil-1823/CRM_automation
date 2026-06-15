import { getConfig } from "./config.js";
import { getRedis } from "./store.js";

const ACCOUNTS_CACHE_KEY = "crm:heyreach:accounts";
const CAMPAIGNS_CACHE_KEY = "crm:heyreach:campaigns";
const CACHE_TTL_SEC = 600; // 10 minutes

/** Campaigns shown in filters — active (in progress) or paused only. */
export const FILTERABLE_CAMPAIGN_STATUSES = new Set([
  "IN_PROGRESS",
  "PAUSED",
  "STARTING",
]);

const COMPLETED_CAMPAIGN_STATUSES = new Set([
  "FINISHED",
  "COMPLETED",
  "CANCELED",
  "CANCELLED",
  "FAILED",
  "DRAFT",
  "SCHEDULED",
]);

function accountDisplayName(item) {
  if (!item || typeof item !== "object") return "";
  const fromParts = [item.firstName, item.lastName].filter(Boolean).join(" ").trim();
  return (
    item.name?.trim() ||
    item.fullName?.trim() ||
    item.accountName?.trim() ||
    fromParts ||
    item.email?.trim() ||
    ""
  );
}

function campaignStatus(item) {
  const raw = item.status ?? item.campaignStatus ?? item.state ?? "";
  return String(raw).trim().toUpperCase();
}

export function isFilterableCampaignStatus(status) {
  const normalized = String(status || "").trim().toUpperCase();
  if (!normalized) return true;
  if (COMPLETED_CAMPAIGN_STATUSES.has(normalized)) return false;
  return FILTERABLE_CAMPAIGN_STATUSES.has(normalized);
}

async function readCache(key) {
  const redis = getRedis();
  if (!redis) return null;
  const raw = await redis.get(key);
  if (!raw?.fetchedAt) return null;
  if (Date.now() - new Date(raw.fetchedAt).getTime() > CACHE_TTL_SEC * 1000) {
    return null;
  }
  return raw.data;
}

async function writeCache(key, data) {
  const redis = getRedis();
  if (!redis) return;
  await redis.set(key, { data, fetchedAt: new Date().toISOString() });
}

async function heyreachFetch(path, { method = "GET", body, apiKey } = {}) {
  const { heyreach } = getConfig();
  const key = apiKey || heyreach.apiKey;
  const res = await fetch(`${heyreach.apiBaseUrl}${path}`, {
    method,
    headers: {
      "X-API-KEY": key,
      "Content-Type": "application/json",
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HeyReach API ${path} failed (${res.status}): ${text}`);
  }

  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchLinkedInAccountsFromApi() {
  const cached = await readCache(ACCOUNTS_CACHE_KEY);
  if (cached) return cached;

  const accounts = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const data = await heyreachFetch("/li_account/GetAll", {
      method: "POST",
      body: { offset, limit },
    });
    const items = data?.items || data?.data?.items || [];
    for (const item of items) {
      const id = Number(item.id ?? item.linkedInAccountId ?? item.accountId);
      if (!Number.isFinite(id)) continue;
      accounts.push({
        id,
        name: accountDisplayName(item) || `LinkedIn account ${id}`,
      });
    }
    if (items.length < limit) break;
    offset += limit;
    if (offset > 500) break;
  }

  await writeCache(ACCOUNTS_CACHE_KEY, accounts);
  return accounts;
}

export async function fetchCampaignsFromApi() {
  const cached = await readCache(CAMPAIGNS_CACHE_KEY);
  if (cached) return cached;

  const campaigns = [];
  let offset = 0;
  const limit = 100;
  const statuses = [...FILTERABLE_CAMPAIGN_STATUSES];

  while (true) {
    const data = await heyreachFetch("/campaign/GetAll", {
      method: "POST",
      body: { offset, limit, statuses },
    });
    const items = data?.items || data?.data?.items || data?.campaigns || [];
    for (const item of items) {
      const id = Number(item.id ?? item.campaignId);
      const name = item.name?.trim() || item.campaignName?.trim() || "";
      const status = campaignStatus(item);
      if (!Number.isFinite(id) && !name) continue;
      if (!isFilterableCampaignStatus(status)) continue;
      campaigns.push({
        id: Number.isFinite(id) ? id : null,
        name: name || (Number.isFinite(id) ? `Campaign ${id}` : "Unnamed campaign"),
        status: status || null,
      });
    }
    if (items.length < limit) break;
    offset += limit;
    if (offset > 1000) break;
  }

  await writeCache(CAMPAIGNS_CACHE_KEY, campaigns);
  return campaigns;
}

/** Build id → name maps from HeyReach API + optional event history. */
export async function getHeyReachMeta(eventAccounts = [], eventCampaigns = []) {
  let apiAccounts = [];
  let apiCampaigns = [];

  try {
    apiAccounts = await fetchLinkedInAccountsFromApi();
  } catch (err) {
    console.warn("HeyReach accounts fetch failed:", err.message);
  }

  try {
    apiCampaigns = await fetchCampaignsFromApi();
  } catch (err) {
    console.warn("HeyReach campaigns fetch failed:", err.message);
  }

  const accountMap = new Map(apiAccounts.map((a) => [a.id, a.name]));
  for (const a of eventAccounts) {
    if (a.id != null && a.name) accountMap.set(Number(a.id), a.name);
  }

  const campaignMap = new Map();
  for (const c of apiCampaigns) {
    const key = c.id != null ? `id:${c.id}` : `name:${c.name}`;
    campaignMap.set(key, { id: c.id, name: c.name, status: c.status ?? null });
  }

  // Only merge event campaigns that are already in the active/paused API list.
  const apiIds = new Set(apiCampaigns.map((c) => c.id).filter((id) => id != null));
  for (const c of eventCampaigns) {
    if (c.id != null && !apiIds.has(Number(c.id))) continue;
    const key = c.id != null ? `id:${c.id}` : c.name ? `name:${c.name}` : null;
    if (key && !campaignMap.has(key)) {
      campaignMap.set(key, { id: c.id ?? null, name: c.name, status: c.status ?? null });
    }
  }

  const accounts = [...accountMap.entries()]
    .map(([id, name]) => ({ id: Number(id), name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const campaigns = [...campaignMap.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  return { accounts, campaigns };
}
