import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// Simple event store for the review dashboard.
// Uses Upstash Redis REST (works with Vercel KV) when env vars are present,
// otherwise falls back to a local JSON file (good for `vercel dev`).
//
// KV layout:
//   key:  crm:events           -> JSON array of event ids (newest first)
//   key:  crm:event:<id>       -> JSON event object

const INDEX_KEY = "crm:events";
const EVENT_PREFIX = "crm:event:";
const MAX_EVENTS = 500;

const KV_URL =
  process.env.KV_REST_API_URL ||
  process.env.UPSTASH_REDIS_REST_URL ||
  "";
const KV_TOKEN =
  process.env.KV_REST_API_TOKEN ||
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  "";

function useKv() {
  return Boolean(KV_URL && KV_TOKEN);
}

async function kvFetch(commandPath) {
  const res = await fetch(`${KV_URL}/${commandPath}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`KV error (${res.status}) on ${commandPath}: ${body}`);
  }
  const data = await res.json();
  return data.result;
}

async function kvGet(key) {
  const raw = await kvFetch(`get/${encodeURIComponent(key)}`);
  if (raw === null || raw === undefined) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

async function kvSet(key, value) {
  const encoded = encodeURIComponent(JSON.stringify(value));
  await kvFetch(`set/${encodeURIComponent(key)}/${encoded}`);
}

async function kvDel(key) {
  await kvFetch(`del/${encodeURIComponent(key)}`);
}

// ---------- file-based fallback ----------

function fileStorePath() {
  if (process.env.EVENTS_STORE_PATH) {
    return process.env.EVENTS_STORE_PATH;
  }
  // /tmp on Vercel is writable but ephemeral per-instance.
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

  if (useKv()) {
    const order = (await kvGet(INDEX_KEY)) || [];
    order.unshift(record.id);
    const trimmed = order.slice(0, MAX_EVENTS);
    await kvSet(`${EVENT_PREFIX}${record.id}`, record);
    await kvSet(INDEX_KEY, trimmed);
    // best-effort cleanup of evicted ids
    for (const evictedId of order.slice(MAX_EVENTS)) {
      try {
        await kvDel(`${EVENT_PREFIX}${evictedId}`);
      } catch {
        /* ignore */
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

export async function listEvents({ limit = 100, status } = {}) {
  let records = [];

  if (useKv()) {
    const order = (await kvGet(INDEX_KEY)) || [];
    const ids = order.slice(0, limit * 2); // overscan for status filtering
    records = (
      await Promise.all(ids.map((id) => kvGet(`${EVENT_PREFIX}${id}`)))
    ).filter(Boolean);
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
  if (useKv()) {
    return kvGet(`${EVENT_PREFIX}${id}`);
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

  if (useKv()) {
    await kvSet(`${EVENT_PREFIX}${id}`, updated);
  } else {
    const state = await readFileStore();
    state.events[id] = updated;
    await writeFileStore(state);
  }
  return updated;
}

export function isUsingKv() {
  return useKv();
}
