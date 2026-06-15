import { getConfig } from "./config.js";
import { getRedis } from "./store.js";

const ACCOUNTS_CACHE_KEY = "crm:heyreach:accounts";
const WORKSPACES_CACHE_KEY = "crm:heyreach:workspaces";
const CAMPAIGNS_CACHE_KEY = "crm:heyreach:campaigns";
const CACHE_TTL_SEC = 600; // 10 minutes

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

export async function fetchWorkspacesFromApi() {
  const { heyreach } = getConfig();
  if (!heyreach.orgApiKey) return [];

  const cached = await readCache(WORKSPACES_CACHE_KEY);
  if (cached) return cached;

  const workspaces = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const data = await heyreachFetch(
      `/management/organizations/workspaces?Offset=${offset}&Limit=${limit}`,
      { apiKey: heyreach.orgApiKey },
    );

    const items = data?.items || data?.data?.items || (Array.isArray(data) ? data : []);
    for (const w of Array.isArray(items) ? items : []) {
      const id = String(w.id ?? w.workspaceId ?? "");
      if (!id) continue;
      workspaces.push({
        id,
        name: w.name?.trim() || w.workspaceName?.trim() || `Workspace ${id}`,
      });
    }

    const total = data?.totalCount ?? data?.data?.totalCount;
    if (!Array.isArray(items) || items.length < limit) break;
    offset += limit;
    if (total != null && offset >= total) break;
    if (offset > 500) break;
  }

  await writeCache(WORKSPACES_CACHE_KEY, workspaces);
  return workspaces;
}

export async function fetchCampaignsFromApi() {
  const cached = await readCache(CAMPAIGNS_CACHE_KEY);
  if (cached) return cached;

  const campaigns = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const data = await heyreachFetch("/campaign/GetAll", {
      method: "POST",
      body: { offset, limit },
    });
    const items = data?.items || data?.data?.items || data?.campaigns || [];
    for (const item of items) {
      const id = Number(item.id ?? item.campaignId);
      const name = item.name?.trim() || item.campaignName?.trim() || "";
      if (!Number.isFinite(id) && !name) continue;
      campaigns.push({
        id: Number.isFinite(id) ? id : null,
        name: name || (Number.isFinite(id) ? `Campaign ${id}` : "Unnamed campaign"),
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
export async function getHeyReachMeta(
  eventAccounts = [],
  eventWorkspaces = [],
  eventCampaigns = [],
) {
  let apiAccounts = [];
  let apiWorkspaces = [];
  let apiCampaigns = [];

  try {
    apiAccounts = await fetchLinkedInAccountsFromApi();
  } catch (err) {
    console.warn("HeyReach accounts fetch failed:", err.message);
  }

  try {
    apiWorkspaces = await fetchWorkspacesFromApi();
  } catch (err) {
    console.warn("HeyReach workspaces fetch failed:", err.message);
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

  const workspaceMap = new Map(apiWorkspaces.map((w) => [w.id, w.name]));
  for (const w of eventWorkspaces) {
    if (!w.id) continue;
    const id = String(w.id);
    if (w.name) workspaceMap.set(id, w.name);
    else if (!workspaceMap.has(id)) workspaceMap.set(id, `Workspace ${id}`);
  }

  const campaignMap = new Map();
  for (const c of apiCampaigns) {
    const key = c.id != null ? `id:${c.id}` : `name:${c.name}`;
    campaignMap.set(key, { id: c.id, name: c.name });
  }
  for (const c of eventCampaigns) {
    const key = c.id != null ? `id:${c.id}` : c.name ? `name:${c.name}` : null;
    if (key) campaignMap.set(key, { id: c.id ?? null, name: c.name });
  }

  const accounts = [...accountMap.entries()]
    .map(([id, name]) => ({ id: Number(id), name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const workspaces = [...workspaceMap.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const campaigns = [...campaignMap.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  return {
    accounts,
    workspaces,
    campaigns,
    hasOrgKey: Boolean(getConfig().heyreach.orgApiKey),
  };
}
