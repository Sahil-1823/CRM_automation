import { getRedis } from "../store.js";

const ACCOUNTS_KEY = "crm:gmail:accounts";
const ACCOUNT_PREFIX = "crm:gmail:account:";
const OAUTH_STATE_PREFIX = "crm:gmail:oauth_state:";
const HISTORY_IDEM_PREFIX = "crm:gmail:history:";
const THREAD_PREFIX = "crm:gmail:thread:";

export async function listGmailAccounts() {
  const redis = getRedis();
  if (!redis) return [];
  return (await redis.get(ACCOUNTS_KEY)) || [];
}

export async function getGmailAccount(email) {
  if (!email) return null;
  const redis = getRedis();
  if (!redis) return null;
  return redis.get(`${ACCOUNT_PREFIX}${email.toLowerCase()}`);
}

export async function saveGmailAccount(record) {
  const redis = getRedis();
  if (!redis) throw new Error("Redis required for Gmail accounts");
  const email = record.email.toLowerCase();
  const key = `${ACCOUNT_PREFIX}${email}`;
  const accounts = (await redis.get(ACCOUNTS_KEY)) || [];
  if (!accounts.includes(email)) {
    await redis.set(ACCOUNTS_KEY, [email, ...accounts]);
  }
  await redis.set(key, { ...record, email, updatedAt: new Date().toISOString() });
  return redis.get(key);
}

export async function removeGmailAccount(email) {
  const redis = getRedis();
  if (!redis) return;
  const normalized = email.toLowerCase();
  await redis.del(`${ACCOUNT_PREFIX}${normalized}`);
  const accounts = (await redis.get(ACCOUNTS_KEY)) || [];
  await redis.set(
    ACCOUNTS_KEY,
    accounts.filter((a) => a !== normalized),
  );
}

export async function saveOAuthState(state, data) {
  const redis = getRedis();
  if (!redis) throw new Error("Redis required for OAuth state");
  await redis.set(`${OAUTH_STATE_PREFIX}${state}`, data, { ex: 600 });
}

export async function consumeOAuthState(state) {
  const redis = getRedis();
  if (!redis) return null;
  const key = `${OAUTH_STATE_PREFIX}${state}`;
  const value = await redis.get(key);
  if (value) await redis.del(key);
  return value;
}

export async function claimHistoryNotification(email, historyId) {
  const redis = getRedis();
  if (!redis) return true;
  const key = `${HISTORY_IDEM_PREFIX}${email.toLowerCase()}:${historyId}`;
  const existing = await redis.get(key);
  if (existing) return false;
  await redis.set(key, { at: new Date().toISOString() }, { ex: 7 * 24 * 60 * 60 });
  return true;
}

export async function setGmailThreadIndex(accountEmail, threadId, eventId) {
  const redis = getRedis();
  if (!redis || !accountEmail || !threadId) return;
  await redis.set(`${THREAD_PREFIX}${accountEmail.toLowerCase()}:${threadId}`, eventId);
}

export async function getGmailThreadEventId(accountEmail, threadId) {
  const redis = getRedis();
  if (!redis) return null;
  return redis.get(`${THREAD_PREFIX}${accountEmail.toLowerCase()}:${threadId}`);
}

export async function updateGmailAccount(email, patch) {
  const current = await getGmailAccount(email);
  if (!current) throw new Error(`Gmail account not found: ${email}`);
  return saveGmailAccount({ ...current, ...patch, email: current.email });
}
