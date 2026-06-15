import OpenAI from "openai";
import { Index } from "@upstash/vector";
import { getConfig } from "./config.js";
import { getRedis } from "./store.js";

const DOCS_INDEX_KEY = "crm:documents";
const CHUNKS_KEY = "crm:doc-chunks";
const CHUNK_SIZE = 600;
const CHUNK_OVERLAP = 80;

function newDocId() {
  return `doc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function getVectorIndex() {
  const { vector } = getConfig();
  if (!vector.url || !vector.token) return null;
  return new Index({ url: vector.url, token: vector.token });
}

function chunkText(text) {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const paragraphs = normalized.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let current = "";

  for (const para of paragraphs) {
    if (`${current}\n\n${para}`.length <= CHUNK_SIZE) {
      current = current ? `${current}\n\n${para}` : para;
      continue;
    }
    if (current) chunks.push(current);
    if (para.length <= CHUNK_SIZE) {
      current = para;
      continue;
    }
    let start = 0;
    while (start < para.length) {
      const end = Math.min(start + CHUNK_SIZE, para.length);
      chunks.push(para.slice(start, end).trim());
      if (end >= para.length) break;
      start = Math.max(end - CHUNK_OVERLAP, start + 1);
    }
    current = "";
  }
  if (current) chunks.push(current);
  return chunks;
}

async function embedTexts(texts) {
  const { openai } = getConfig();
  const client = new OpenAI({ apiKey: openai.apiKey });
  const response = await client.embeddings.create({
    model: openai.embeddingModel,
    input: texts,
  });
  return response.data.map((row) => row.embedding);
}

function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function readDocIndex() {
  const redis = getRedis();
  if (redis) return (await redis.get(DOCS_INDEX_KEY)) || [];
  return [];
}

async function writeDocIndex(docs) {
  const redis = getRedis();
  if (redis) await redis.set(DOCS_INDEX_KEY, docs);
}

async function readRedisChunks() {
  const redis = getRedis();
  if (!redis) return [];
  return (await redis.get(CHUNKS_KEY)) || [];
}

async function writeRedisChunks(chunks) {
  const redis = getRedis();
  if (redis) await redis.set(CHUNKS_KEY, chunks);
}

export async function addDocument({ title, content }) {
  if (!getRedis()) {
    throw new Error(
      "Redis is required for document storage. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.",
    );
  }

  const trimmedTitle = title?.trim();
  const trimmedContent = content?.trim();
  if (!trimmedTitle) throw new Error("Document title is required");
  if (!trimmedContent) throw new Error("Document content is required");

  const docId = newDocId();
  const chunks = chunkText(trimmedContent);
  if (!chunks.length) throw new Error("Document has no indexable content");

  const embeddings = await embedTexts(chunks);
  const vectorIndex = getVectorIndex();

  if (vectorIndex) {
    const records = chunks.map((text, i) => ({
      id: `${docId}:${i}`,
      vector: embeddings[i],
      metadata: { docId, title: trimmedTitle, chunkIndex: i, text },
    }));
    await vectorIndex.upsert(records);
  } else {
    const existing = await readRedisChunks();
    const newChunks = chunks.map((text, i) => ({
      id: `${docId}:${i}`,
      docId,
      title: trimmedTitle,
      chunkIndex: i,
      text,
      vector: embeddings[i],
    }));
    await writeRedisChunks([...existing, ...newChunks]);
  }

  const docs = await readDocIndex();
  const record = {
    id: docId,
    title: trimmedTitle,
    chunkCount: chunks.length,
    createdAt: new Date().toISOString(),
  };
  docs.unshift(record);
  await writeDocIndex(docs);
  return record;
}

export async function listDocuments() {
  return readDocIndex();
}

export async function deleteDocument(docId) {
  const docs = await readDocIndex();
  const remaining = docs.filter((d) => d.id !== docId);
  if (remaining.length === docs.length) {
    throw new Error(`Document not found: ${docId}`);
  }

  const vectorIndex = getVectorIndex();
  if (vectorIndex) {
    const toDelete = docs.find((d) => d.id === docId);
    const ids = Array.from({ length: toDelete.chunkCount }, (_, i) => `${docId}:${i}`);
    if (ids.length) await vectorIndex.delete(ids);
  } else {
    const chunks = await readRedisChunks();
    await writeRedisChunks(chunks.filter((c) => c.docId !== docId));
  }

  await writeDocIndex(remaining);
  return { deleted: docId };
}

export async function retrieveContext(query, { topK = 4 } = {}) {
  const trimmed = query?.trim();
  if (!trimmed) return [];

  const docs = await readDocIndex();
  if (!docs.length) return [];

  const [queryVector] = await embedTexts([trimmed]);
  const vectorIndex = getVectorIndex();

  if (vectorIndex) {
    const results = await vectorIndex.query({
      vector: queryVector,
      topK,
      includeMetadata: true,
    });
    return (results || [])
      .filter((r) => r.metadata?.text)
      .map((r) => ({
        title: r.metadata.title,
        text: r.metadata.text,
        score: r.score,
      }));
  }

  const chunks = await readRedisChunks();
  if (!chunks.length) return [];

  return chunks
    .map((chunk) => ({
      title: chunk.title,
      text: chunk.text,
      score: cosineSimilarity(queryVector, chunk.vector),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

export function isUsingVector() {
  return getVectorIndex() !== null;
}
