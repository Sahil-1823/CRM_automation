import crypto from "node:crypto";
import { getRedis } from "./store.js";

/* ----------------------------- structured log ----------------------------- */

/** Single-line JSON log for easy filtering in Vercel logs. */
export function log(level, event, fields = {}) {
  const line = {
    t: new Date().toISOString(),
    level,
    event,
    ...fields,
  };
  const stream = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  try {
    stream(JSON.stringify(line));
  } catch {
    stream(`${level} ${event}`);
  }
}

/* ------------------------------- key helpers ------------------------------ */

function sha1(value) {
  return crypto.createHash("sha1").update(String(value)).digest("hex");
}

/* --------------------------- idempotency (Redis) -------------------------- */

const IDEMPOTENCY_PREFIX = "crm:idem:";
const IDEMPOTENCY_TTL_SEC = 60 * 60 * 24; // 24h

/**
 * Build a stable key from webhook payload — same lead reply within 24h is a dup.
 * Falls back to a sha of the raw payload if conversation id is missing.
 */
export function buildIdempotencyKey({ conversationId, eventType, latestText, fallbackBody }) {
  if (conversationId && latestText) {
    return `${conversationId}:${eventType || "x"}:${sha1(latestText.trim())}`;
  }
  return `raw:${sha1(fallbackBody || "")}`;
}

/**
 * Atomically mark a webhook id as seen. Returns true if first time, false if duplicate.
 * No-op (always returns true) when Redis is unavailable.
 */
export async function claimIdempotencyKey(key) {
  const redis = getRedis();
  if (!redis || !key) return true;

  try {
    const result = await redis.set(`${IDEMPOTENCY_PREFIX}${key}`, 1, {
      nx: true,
      ex: IDEMPOTENCY_TTL_SEC,
    });
    return result === "OK" || result === true;
  } catch (err) {
    log("warn", "idempotency.error", { error: err.message });
    return true;
  }
}

/* ------------------------ GetChatroom cache (Redis) ----------------------- */

const CHATROOM_PREFIX = "crm:chatroom:";
const CHATROOM_TTL_SEC = 60;

export async function readChatroomCache(conversationId, linkedInAccountId) {
  const redis = getRedis();
  if (!redis || !conversationId || !linkedInAccountId) return null;
  try {
    const value = await redis.get(
      `${CHATROOM_PREFIX}${linkedInAccountId}:${conversationId}`,
    );
    if (!value) return null;
    if (!Array.isArray(value) && typeof value === "object" && Array.isArray(value.thread)) {
      return value.thread;
    }
    return Array.isArray(value) ? value : null;
  } catch (err) {
    log("warn", "chatroom_cache.read_error", { error: err.message });
    return null;
  }
}

export async function writeChatroomCache(conversationId, linkedInAccountId, thread) {
  const redis = getRedis();
  if (!redis || !conversationId || !linkedInAccountId || !Array.isArray(thread)) return;
  try {
    await redis.set(
      `${CHATROOM_PREFIX}${linkedInAccountId}:${conversationId}`,
      { thread, cachedAt: new Date().toISOString() },
      { ex: CHATROOM_TTL_SEC },
    );
  } catch (err) {
    log("warn", "chatroom_cache.write_error", { error: err.message });
  }
}

/* -------------------------- raw webhook archive --------------------------- */

const RAW_PREFIX = "crm:raw:";
const RAW_INDEX_KEY = "crm:raw:index";
const RAW_TTL_SEC = 60 * 60 * 24 * 7; // 7 days
const RAW_INDEX_MAX = 200;

/**
 * Archive raw webhook payload for debugging. Best-effort only.
 * Returns a short id you can attach to logs.
 */
export async function archiveRawWebhook(payload, meta = {}) {
  const id = `${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
  const redis = getRedis();
  if (!redis) return id;

  try {
    await redis.set(
      `${RAW_PREFIX}${id}`,
      {
        id,
        receivedAt: new Date().toISOString(),
        meta,
        payload,
      },
      { ex: RAW_TTL_SEC },
    );
    const order = (await redis.get(RAW_INDEX_KEY)) || [];
    const next = [id, ...order].slice(0, RAW_INDEX_MAX);
    await redis.set(RAW_INDEX_KEY, next);
  } catch (err) {
    log("warn", "raw_archive.error", { error: err.message });
  }
  return id;
}
