import { getRedis } from "./store.js";

const ACCOUNTS_KEY = "crm:linkedin-accounts";

function newAccountId() {
  return `acct_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function listAccounts() {
  const redis = getRedis();
  if (!redis) return [];
  return (await redis.get(ACCOUNTS_KEY)) || [];
}

export async function getAccount(id) {
  if (!id) return null;
  const accounts = await listAccounts();
  return accounts.find((a) => a.id === id) || null;
}

export async function findAccountByHeyReachId(linkedInAccountId) {
  const id = Number(linkedInAccountId);
  if (!Number.isFinite(id)) return null;
  const accounts = await listAccounts();
  return accounts.find((a) => a.linkedInAccountId === id) || null;
}

/** Resolve display info for a HeyReach linkedInAccountId from configured accounts. */
export async function resolveLinkedInAccount(linkedInAccountId) {
  const id = Number(linkedInAccountId);
  if (!Number.isFinite(id)) return null;

  const configured = await findAccountByHeyReachId(id);
  if (configured) {
    return {
      accountId: configured.id,
      linkedInAccountId: configured.linkedInAccountId,
      label: configured.label,
    };
  }

  return {
    accountId: null,
    linkedInAccountId: id,
    label: `Account ${id}`,
  };
}

export async function createAccount({ label, linkedInAccountId }) {
  const redis = getRedis();
  if (!redis) throw new Error("Redis is required to manage LinkedIn accounts");

  const trimLabel = label?.trim();
  if (!trimLabel) throw new Error("Account label is required");

  const heyreachId = Number(linkedInAccountId);
  if (!Number.isFinite(heyreachId)) {
    throw new Error("HeyReach LinkedIn account ID must be a number");
  }

  const accounts = await listAccounts();
  if (accounts.some((a) => a.linkedInAccountId === heyreachId)) {
    throw new Error(`Account ID ${heyreachId} is already registered`);
  }

  const account = {
    id: newAccountId(),
    label: trimLabel,
    linkedInAccountId: heyreachId,
    createdAt: new Date().toISOString(),
  };
  accounts.unshift(account);
  await redis.set(ACCOUNTS_KEY, accounts);
  return account;
}

export async function updateAccount(id, { label, linkedInAccountId }) {
  const redis = getRedis();
  if (!redis) throw new Error("Redis is required");

  const accounts = await listAccounts();
  const idx = accounts.findIndex((a) => a.id === id);
  if (idx === -1) throw new Error(`Account not found: ${id}`);

  const current = accounts[idx];
  const nextId =
    linkedInAccountId !== undefined ? Number(linkedInAccountId) : current.linkedInAccountId;
  if (!Number.isFinite(nextId)) {
    throw new Error("HeyReach LinkedIn account ID must be a number");
  }

  if (accounts.some((a) => a.id !== id && a.linkedInAccountId === nextId)) {
    throw new Error(`Account ID ${nextId} is already registered`);
  }

  accounts[idx] = {
    ...current,
    label: label !== undefined ? label.trim() : current.label,
    linkedInAccountId: nextId,
    updatedAt: new Date().toISOString(),
  };
  await redis.set(ACCOUNTS_KEY, accounts);
  return accounts[idx];
}

export async function deleteAccount(id) {
  const redis = getRedis();
  if (!redis) throw new Error("Redis is required");

  const accounts = await listAccounts();
  const filtered = accounts.filter((a) => a.id !== id);
  if (filtered.length === accounts.length) {
    throw new Error(`Account not found: ${id}`);
  }
  await redis.set(ACCOUNTS_KEY, filtered);
  return { deleted: id };
}
