import crypto from "node:crypto";
import { getConfig } from "../config.js";
import { getRedis } from "../store.js";
import { verifyHeyReachSecret } from "./client.js";

const ACCOUNTS_KEY = "crm:heyreach:connected";
const ACCOUNT_PREFIX = "crm:heyreach:connected:";

export const DEFAULT_ACCOUNT_ID = "default";

export function slugifyHeyReachAccountId(value) {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "workspace";
}

export function generateWebhookSecret() {
  return crypto.randomBytes(24).toString("hex");
}

export function getSyntheticDefaultAccount() {
  const { heyreach } = getConfig();
  if (!heyreach.apiKey) return null;
  return {
    id: DEFAULT_ACCOUNT_ID,
    label: "Default (env)",
    apiKey: heyreach.apiKey,
    webhookSecret: heyreach.webhookSecret || "",
    projectId: null,
    calendlyLink: null,
    isSynthetic: true,
    createdAt: null,
    updatedAt: null,
  };
}

export async function listHeyReachAccounts({ includeSynthetic = true } = {}) {
  const redis = getRedis();
  let ids = [];
  if (redis) {
    ids = (await redis.get(ACCOUNTS_KEY)) || [];
  }
  const accounts = [];
  for (const id of ids) {
    const account = await getHeyReachAccount(id);
    if (account && !account.isSynthetic) accounts.push(account);
  }
  if (includeSynthetic && accounts.length === 0) {
    const synthetic = getSyntheticDefaultAccount();
    if (synthetic) accounts.push(synthetic);
  }
  return accounts;
}

export async function getHeyReachAccount(id) {
  if (!id) return null;
  if (id === DEFAULT_ACCOUNT_ID) {
    const synthetic = getSyntheticDefaultAccount();
    if (synthetic) return synthetic;
  }
  const redis = getRedis();
  if (!redis) return null;
  return redis.get(`${ACCOUNT_PREFIX}${id}`);
}

export async function resolveHeyReachWebhookAccount(req) {
  const url = new URL(req.url || "/", "http://localhost");
  const accountId = url.searchParams.get("account");
  const token = url.searchParams.get("token");

  if (accountId && token) {
    const account = await getHeyReachAccount(accountId);
    if (!account) return { ok: false, error: "Unknown HeyReach account" };
    if (!account.webhookSecret || account.webhookSecret !== token) {
      return { ok: false, error: "Invalid webhook token" };
    }
    return { ok: true, account };
  }

  const { heyreach } = getConfig();
  if (verifyHeyReachSecret(req, heyreach.webhookSecret)) {
    const synthetic = getSyntheticDefaultAccount();
    if (synthetic) return { ok: true, account: synthetic };
  }

  return { ok: false, error: "Unauthorized" };
}

export function buildHeyReachWebhookUrl(account, baseUrl) {
  if (!baseUrl || !account?.id || !account?.webhookSecret) return null;
  const root = baseUrl.replace(/\/$/, "");
  return `${root}/api/heyreach-webhook?account=${encodeURIComponent(account.id)}&token=${encodeURIComponent(account.webhookSecret)}`;
}

export function serializeHeyReachAccountForDashboard(account, { baseUrl } = {}) {
  return {
    id: account.id,
    label: account.label,
    projectId: account.projectId || null,
    calendlyLink: account.calendlyLink || null,
    hasApiKey: !!account.apiKey,
    apiKeyPreview: account.apiKey
      ? `${account.apiKey.slice(0, 4)}…${account.apiKey.slice(-4)}`
      : null,
    webhookUrl: buildHeyReachWebhookUrl(account, baseUrl),
    isSynthetic: !!account.isSynthetic,
    createdAt: account.createdAt || null,
    updatedAt: account.updatedAt || null,
  };
}

export async function saveHeyReachAccount(record) {
  const redis = getRedis();
  if (!redis) throw new Error("Redis required for HeyReach accounts");

  const id = record.id || slugifyHeyReachAccountId(record.label);
  if (!id) throw new Error("Account id is required");
  if (id === DEFAULT_ACCOUNT_ID) {
    throw new Error(`Reserved account id: ${DEFAULT_ACCOUNT_ID}`);
  }

  const existing = await getHeyReachAccount(id);
  const now = new Date().toISOString();
  const saved = {
    id,
    label: record.label?.trim() || id,
    apiKey: record.apiKey?.trim() || "",
    webhookSecret: record.webhookSecret?.trim() || generateWebhookSecret(),
    projectId: record.projectId || null,
    calendlyLink: record.calendlyLink?.trim() || null,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  const accounts = (await redis.get(ACCOUNTS_KEY)) || [];
  if (!accounts.includes(id)) {
    await redis.set(ACCOUNTS_KEY, [id, ...accounts]);
  }
  await redis.set(`${ACCOUNT_PREFIX}${id}`, saved);
  return saved;
}

export async function updateHeyReachAccount(id, patch) {
  const current = await getHeyReachAccount(id);
  if (!current || current.isSynthetic) {
    throw new Error(`HeyReach account not found: ${id}`);
  }
  return saveHeyReachAccount({
    ...current,
    ...patch,
    id: current.id,
    webhookSecret: patch.webhookSecret?.trim() || current.webhookSecret,
    apiKey: patch.apiKey !== undefined ? patch.apiKey?.trim() || "" : current.apiKey,
    label: patch.label !== undefined ? patch.label?.trim() || current.label : current.label,
    projectId: patch.projectId !== undefined ? patch.projectId || null : current.projectId,
    calendlyLink:
      patch.calendlyLink !== undefined ? patch.calendlyLink?.trim() || null : current.calendlyLink,
  });
}

export async function removeHeyReachAccount(id) {
  if (!id || id === DEFAULT_ACCOUNT_ID) {
    throw new Error("Cannot remove the default env account");
  }
  const redis = getRedis();
  if (!redis) return;
  await redis.del(`${ACCOUNT_PREFIX}${id}`);
  const accounts = (await redis.get(ACCOUNTS_KEY)) || [];
  await redis.set(
    ACCOUNTS_KEY,
    accounts.filter((entry) => entry !== id),
  );
}

export async function getHeyReachProjectBinding(account) {
  if (!account?.projectId) return { projectOverride: undefined, projectScopeOverride: undefined };
  const { getProject } = await import("../projects.js");
  const project = await getProject(account.projectId);
  if (!project) return { projectOverride: undefined, projectScopeOverride: undefined };
  return { projectOverride: project, projectScopeOverride: "project" };
}
