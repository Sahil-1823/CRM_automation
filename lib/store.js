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
const CONV_LATEST_PREFIX = "crm:conv:latest:";
const CONV_EVENTS_PREFIX = "crm:conv:events:";
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

function conversationIdFromEvent(event) {
  const id = event?.lead?.conversationId;
  return id != null ? String(id) : "";
}

async function indexConversationEvent(redis, event) {
  const conversationId = conversationIdFromEvent(event);
  if (!conversationId) return;

  const latestKey = `${CONV_LATEST_PREFIX}${conversationId}`;
  const listKey = `${CONV_EVENTS_PREFIX}${conversationId}`;

  await redis.set(latestKey, event.id);

  const current = (await redis.get(listKey)) || [];
  const next = [event.id, ...current.filter((id) => id !== event.id)].slice(0, MAX_EVENTS);
  await redis.set(listKey, next);
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
    await indexConversationEvent(redis, record);

    const evicted = order.slice(MAX_EVENTS);
    if (evicted.length) {
      const evictedKeys = evicted.map((id) => `${EVENT_PREFIX}${id}`);
      const evictedValues = await redis.mget(...evictedKeys);
      await redis.del(...evictedKeys);
      for (const evictedEvent of evictedValues.filter(Boolean)) {
        const convId = conversationIdFromEvent(evictedEvent);
        if (!convId) continue;
        const listKey = `${CONV_EVENTS_PREFIX}${convId}`;
        const latestKey = `${CONV_LATEST_PREFIX}${convId}`;
        const list = (await redis.get(listKey)) || [];
        const next = list.filter((id) => id !== evictedEvent.id);
        if (next.length) {
          await redis.set(listKey, next);
        } else {
          await redis.del(listKey);
        }
        const latest = await redis.get(latestKey);
        if (latest === evictedEvent.id) {
          if (next.length) await redis.set(latestKey, next[0]);
          else await redis.del(latestKey);
        }
      }
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
  const key = String(conversationId);
  const redis = getRedis();
  if (redis) {
    const latestId = await redis.get(`${CONV_LATEST_PREFIX}${key}`);
    if (latestId) {
      const latest = await redis.get(`${EVENT_PREFIX}${latestId}`);
      if (latest && (!status || latest.status === status)) return latest;
    }

    const convIds = (await redis.get(`${CONV_EVENTS_PREFIX}${key}`)) || [];
    if (convIds.length) {
      const keys = convIds.map((id) => `${EVENT_PREFIX}${id}`);
      const values = await redis.mget(...keys);
      const records = values.filter(Boolean);
      return records.find((event) => !status || event.status === status) || null;
    }
  }

  const events = await listEvents({ limit: MAX_EVENTS, status });
  return (
    events.find(
      (event) =>
        event?.lead?.conversationId &&
        String(event.lead.conversationId) === key,
    ) || null
  );
}

/** All dashboard events for one HeyReach conversation (newest first). */
export async function findAllEventsByConversationId(conversationId) {
  if (!conversationId) return [];
  const key = String(conversationId);
  const redis = getRedis();
  if (redis) {
    const convIds = (await redis.get(`${CONV_EVENTS_PREFIX}${key}`)) || [];
    if (convIds.length) {
      const keys = convIds.map((id) => `${EVENT_PREFIX}${id}`);
      const values = await redis.mget(...keys);
      return values.filter(Boolean);
    }
  }

  const events = await listEvents({ limit: MAX_EVENTS });
  return events.filter(
    (event) =>
      event?.lead?.conversationId &&
      String(event.lead.conversationId) === key,
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
    await indexConversationEvent(redis, updated);
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
    const events = eventKeys.length ? (await redis.mget(...eventKeys)).filter(Boolean) : [];
    const convKeys = new Set();
    for (const event of events) {
      const convId = conversationIdFromEvent(event);
      if (!convId) continue;
      convKeys.add(`${CONV_LATEST_PREFIX}${convId}`);
      convKeys.add(`${CONV_EVENTS_PREFIX}${convId}`);
    }
    if (eventKeys.length) {
      await redis.del(...eventKeys);
    }
    if (convKeys.size) {
      await redis.del(...convKeys);
    }
    await redis.del(INDEX_KEY);
    return { deleted: order.length, storage: "redis" };
  }

  const state = await readFileStore();
  const deleted = (state.order || []).length;
  await writeFileStore({ events: {}, order: [] });
  return { deleted, storage: "file" };
}

/**
 * Whitelist the fields the dashboard UI actually consumes.
 * Strips internal/sensitive data (raw HeyReach API responses, workspace IDs,
 * LinkedIn URLs, etc.) before sending an event to the browser.
 */
export function serializeEvent(event) {
  if (!event || typeof event !== "object") return event;

  const lead = event.lead || {};
  const draft = event.draft || {};
  const sentiment = event.sentiment || {};

  const out = {
    id: event.id,
    status: event.status,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
    sentAt: event.sentAt,
    refreshedAt: event.refreshedAt,
    conversationSyncedAt: event.conversationSyncedAt,
    messageType: event.messageType ?? null,
    draftProjectId: event.draftProjectId ?? null,
    sentiment: {
      label: sentiment.label ?? null,
      isPositive: sentiment.isPositive ?? null,
      reasoning: sentiment.reasoning ?? null,
    },
    handling: event.handling
      ? {
          requiresHuman: !!event.handling.requiresHuman,
          category: event.handling.category ?? null,
          actionItems: event.handling.actionItems ?? [],
          reason: event.handling.reason ?? null,
        }
      : null,
    project: event.project
      ? { id: event.project.id ?? null, name: event.project.name ?? null }
      : null,
    campaign: event.campaign
      ? { id: event.campaign.id ?? null, name: event.campaign.name ?? null }
      : null,
    linkedInAccount: event.linkedInAccount
      ? {
          linkedInAccountId: event.linkedInAccount.linkedInAccountId ?? null,
          name: event.linkedInAccount.name ?? null,
        }
      : null,
    draft: {
      reply: draft.reply ?? "",
      rationale: draft.rationale ?? "",
      error: draft.error ?? null,
      skipped: draft.skipped ?? false,
      hasGrounding: draft.hasGrounding ?? null,
      ragSources: draft.ragSources ?? [],
      citedSources: draft.citedSources ?? [],
    },
    lead: {
      fullName: lead.fullName ?? null,
      companyName: lead.companyName ?? null,
      jobTitle: lead.jobTitle ?? null,
      conversation: lead.conversation ?? [],
      conversationId: lead.conversationId ?? null,
      linkedInAccountId: lead.linkedInAccountId ?? null,
      linkedInAccountName: lead.linkedInAccountName ?? null,
      campaignId: lead.campaignId ?? null,
      campaignName: lead.campaignName ?? null,
      messageType: lead.messageType ?? null,
      eventType: lead.eventType ?? null,
      replyMessage: lead.replyMessage ?? "",
      yourMessage: lead.yourMessage ?? "",
    },
  };

  // Keep only the display fields of sendResult; drop raw HeyReach API response
  // and internal linkedInAccountId echo.
  if (event.sendResult) {
    out.sendResult = {
      reply: event.sendResult.reply ?? "",
      sentAt: event.sendResult.sentAt ?? null,
    };
  }

  return out;
}

export function serializeEvents(events) {
  return (events || []).map(serializeEvent);
}

/** @deprecated use isUsingRedis */
export function isUsingKv() {
  return useRedis();
}

export function isUsingRedis() {
  return useRedis();
}
