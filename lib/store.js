import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Redis } from "@upstash/redis";

// Event store for the review dashboard.
// Uses @upstash/redis when Upstash (or Vercel KV) env vars are set,
// otherwise falls back to a local JSON file (good for `vercel dev`).
//
// Redis layout:
//   key:  crm:events           -> JSON array of event ids (newest first)
//   key:  crm:event:<id>       -> JSON event object

const INDEX_KEY = "crm:events";
const EVENT_PREFIX = "crm:event:";
const MAX_EVENTS = 500;

let redisClient = null;

function getRedisUrl() {
  return (
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL ||
    ""
  );
}

function getRedisToken() {
  return (
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    ""
  );
}

export function getRedis() {
  if (redisClient) return redisClient;

  const url = getRedisUrl();
  const token = getRedisToken();
  if (!url || !token) return null;

  redisClient = new Redis({ url, token });
  return redisClient;
}

function useRedis() {
  return getRedis() !== null;
}

// ---------- file-based fallback ----------

function fileStorePath() {
  if (process.env.EVENTS_STORE_PATH) {
    return process.env.EVENTS_STORE_PATH;
  }
  const base = process.env.VERCEL ? "/tmp" : path.join(os.tmpdir(), "crm-automation");
  return path.join(base, "events.json");
}

async function readFileStore() {
  const file = fileStorePath();
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      return { events: {}, order: [] };
    }
    throw error;
  }
}

async function writeFileStore(state) {
  const file = fileStorePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(state, null, 2), "utf8");
}

// ---------- public API ----------

function newId() {
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function saveEvent(event) {
  const record = {
    id: newId(),
    createdAt: new Date().toISOString(),
    status: "pending_review",
    ...event,
  };

  const redis = getRedis();
  if (redis) {
    const order = (await redis.get(INDEX_KEY)) || [];
    order.unshift(record.id);
    const trimmed = order.slice(0, MAX_EVENTS);
    await redis.set(`${EVENT_PREFIX}${record.id}`, record);
    await redis.set(INDEX_KEY, trimmed);

    const evicted = order.slice(MAX_EVENTS);
    if (evicted.length) {
      await redis.del(...evicted.map((id) => `${EVENT_PREFIX}${id}`));
    }
    return record;
  }

  const state = await readFileStore();
  state.events[record.id] = record;
  state.order = [record.id, ...(state.order || [])].slice(0, MAX_EVENTS);
  await writeFileStore(state);
  return record;
}

/**
 * Find the most recent event for a conversation id.
 * Optionally limit to one status (e.g. pending_review).
 */
export async function findEventByConversationId(conversationId, { status } = {}) {
  if (!conversationId) return null;
  const events = await listEvents({ limit: MAX_EVENTS, status });
  return (
    events.find(
      (event) =>
        event?.lead?.conversationId &&
        String(event.lead.conversationId) === String(conversationId),
    ) || null
  );
}

export async function listEvents({ limit = 100, status } = {}) {
  let records = [];

  const redis = getRedis();
  if (redis) {
    const order = (await redis.get(INDEX_KEY)) || [];
    const ids = order.slice(0, limit * 2);
    if (ids.length) {
      const keys = ids.map((id) => `${EVENT_PREFIX}${id}`);
      const values = await redis.mget(...keys);
      records = values.filter(Boolean);
    }
  } else {
    const state = await readFileStore();
    records = (state.order || [])
      .map((id) => state.events[id])
      .filter(Boolean);
  }

  if (status) {
    records = records.filter((r) => r.status === status);
  }
  return records.slice(0, limit);
}

export async function getEvent(id) {
  const redis = getRedis();
  if (redis) {
    return redis.get(`${EVENT_PREFIX}${id}`);
  }
  const state = await readFileStore();
  return state.events[id] || null;
}

export async function updateEvent(id, patch) {
  const current = await getEvent(id);
  if (!current) {
    throw new Error(`Event not found: ${id}`);
  }
  const updated = { ...current, ...patch, id, updatedAt: new Date().toISOString() };

  const redis = getRedis();
  if (redis) {
    await redis.set(`${EVENT_PREFIX}${id}`, updated);
  } else {
    const state = await readFileStore();
    state.events[id] = updated;
    await writeFileStore(state);
  }
  return updated;
}

export async function clearAllEvents() {
  const redis = getRedis();
  if (redis) {
    const order = (await redis.get(INDEX_KEY)) || [];
    const eventKeys = order.map((id) => `${EVENT_PREFIX}${id}`);
    if (eventKeys.length) {
      await redis.del(...eventKeys);
    }
    await redis.del(INDEX_KEY);
    return { deleted: order.length, storage: "redis" };
  }

  const state = await readFileStore();
  const deleted = (state.order || []).length;
  await writeFileStore({ events: {}, order: [] });
  return { deleted, storage: "file" };
}

/** @deprecated use isUsingRedis */
export function isUsingKv() {
  return useRedis();
}

export function isUsingRedis() {
  return useRedis();
}
