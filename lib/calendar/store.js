import { getRedis } from "../store.js";

const GCAL_OAUTH_KEY = "crm:gcal:oauth";

export async function getGoogleOAuthTokens() {
  const redis = getRedis();
  if (!redis) return null;
  return redis.get(GCAL_OAUTH_KEY);
}

export async function saveGoogleOAuthTokens(record) {
  const redis = getRedis();
  if (!redis) {
    throw new Error("Redis is required to store Google Calendar tokens");
  }
  await redis.set(GCAL_OAUTH_KEY, {
    ...record,
    updatedAt: new Date().toISOString(),
  });
}

export async function clearGoogleOAuthTokens() {
  const redis = getRedis();
  if (!redis) return;
  await redis.del(GCAL_OAUTH_KEY);
}

export async function isGoogleCalendarConnected() {
  const tokens = await getGoogleOAuthTokens();
  return Boolean(tokens?.refreshToken);
}
