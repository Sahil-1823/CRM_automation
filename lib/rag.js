import OpenAI from "openai";
import { Index } from "@upstash/vector";
import { getConfig } from "./config.js";
import { getRedis } from "./store.js";

const DOCS_INDEX_KEY = "crm:documents";
const CHUNKS_KEY = "crm:doc-chunks";
const MD_PREFIX = "crm:doc-md:";

// ~400 tokens at 4 chars/token — industry standard "small chunk" size
const CHUNK_CHARS = 1600;
const CHUNK_OVERLAP_CHARS = 160;
const SCORE_THRESHOLD = 0.25;

function newDocId() {
  return `doc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function getVectorIndex() {
  const { vector } = getConfig();
  if (!vector.url || !vector.token) return null;
  return new Index({ url: vector.url, token: vector.token });
}

// ---------- Structural chunking ----------

/**
 * Split markdown text into semantically meaningful chunks.
 * Strategy:
 *   1. Split on Markdown headings (# / ## / etc.) to preserve document structure.
 *   2. Within each section, split by paragraph boundaries if it exceeds CHUNK_CHARS.
 *   3. Hard-split single oversized paragraphs with character-level overlap.
 *
 * Approximate token count: chars / 4 (GPT tokenizer heuristic).
 */
export function chunkText(text) {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  // Split on heading lines — keep the heading with its section
  const sectionBoundary = /(?=^#{1,6} )/m;
  const sections = normalized.split(sectionBoundary).filter(Boolean);

  const chunks = [];

  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;

    if (trimmed.length <= CHUNK_CHARS) {
      chunks.push(trimmed);
      continue;
    }

    // Section too large — split by paragraphs
    const paragraphs = trimmed.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    let current = "";

    for (const para of paragraphs) {
      const candidate = current ? `${current}\n\n${para}` : para;

      if (candidate.length <= CHUNK_CHARS) {
        current = candidate;
        continue;
      }

      if (current) {
        chunks.push(current);
        // Overlap: carry the tail of the previous chunk forward
        const overlap = current.slice(-CHUNK_OVERLAP_CHARS);
        current = overlap ? `${overlap}\n\n${para}` : para;
      } else {
        // Single paragraph larger than CHUNK_CHARS — hard split with overlap
        let start = 0;
        while (start < para.length) {
          const end = Math.min(start + CHUNK_CHARS, para.length);
          chunks.push(para.slice(start, end).trim());
          if (end >= para.length) break;
          start = Math.max(end - CHUNK_OVERLAP_CHARS, start + 1);
        }
        current = "";
      }
    }

    if (current) chunks.push(current);
  }

  return chunks.filter(Boolean);
}

// ---------- Embeddings ----------

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

// ---------- Query rewriting ----------

/**
 * Use the LLM to rewrite a raw conversation snippet into a focused
 * document-retrieval search query (max ~15 words).
 * Falls back to a truncated version of the raw query on error.
 */
export async function rewriteSearchQuery(rawQuery) {
  try {
    const { openai } = getConfig();
    const client = new OpenAI({ apiKey: openai.apiKey });

    const resp = await client.chat.completions.create({
      model: openai.model,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "Convert the following LinkedIn sales conversation excerpt into a short, focused document search query " +
            "(max 15 words). Extract the core topic the lead is asking about. " +
            "Reply with the search query only — no punctuation, no explanation.",
        },
        { role: "user", content: rawQuery.slice(0, 1000) },
      ],
    });

    return resp.choices[0]?.message?.content?.trim() || rawQuery.slice(0, 200);
  } catch {
    return rawQuery.slice(0, 200);
  }
}

// ---------- Redis storage helpers ----------

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

// ---------- Public API ----------

/**
 * Add a document to the knowledge base.
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} opts.content - Markdown text
 * @param {string|null} opts.sourceFilename
 * @param {boolean} opts.markdownStored
 * @param {string} opts.projectId - "global" for unassigned; defaults to "global"
 */
export async function addDocument({
  title,
  content,
  sourceFilename,
  markdownStored = true,
  projectId = "global",
}) {
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
  const resolvedProjectId = projectId || "global";
  const chunks = chunkText(trimmedContent);
  if (!chunks.length) throw new Error("Document has no indexable content");

  const redis = getRedis();
  await redis.set(`${MD_PREFIX}${docId}`, {
    markdown: trimmedContent,
    sourceFilename: sourceFilename || null,
    updatedAt: new Date().toISOString(),
  });

  const embeddings = await embedTexts(chunks);
  const vectorIndex = getVectorIndex();

  if (vectorIndex) {
    const records = chunks.map((text, i) => ({
      id: `${docId}:${i}`,
      vector: embeddings[i],
      metadata: {
        docId,
        title: trimmedTitle,
        chunkIndex: i,
        text,
        projectId: resolvedProjectId,
      },
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
      projectId: resolvedProjectId,
    }));
    await writeRedisChunks([...existing, ...newChunks]);
  }

  const docs = await readDocIndex();
  const record = {
    id: docId,
    title: trimmedTitle,
    chunkCount: chunks.length,
    charCount: trimmedContent.length,
    sourceFilename: sourceFilename || null,
    projectId: resolvedProjectId,
    format: "md",
    markdownStored,
    createdAt: new Date().toISOString(),
  };
  docs.unshift(record);
  await writeDocIndex(docs);
  return record;
}

export async function getDocumentMarkdown(docId) {
  const redis = getRedis();
  if (!redis) return null;
  return redis.get(`${MD_PREFIX}${docId}`);
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
  if (getRedis()) {
    await getRedis().del(`${MD_PREFIX}${docId}`);
  }
  return { deleted: docId };
}

/**
 * Retrieve relevant chunks for a query.
 *
 * Improvements over naive retrieval:
 *   - Optional LLM query rewriting extracts the core topic before embedding.
 *   - Score threshold (SCORE_THRESHOLD) filters out irrelevant chunks.
 *   - Project scoping: returns chunks from the specified project + global ("unassigned") docs.
 *   - Over-fetches topK*2 then applies threshold, so the final count may be < topK.
 *
 * @param {string} query
 * @param {object} options
 * @param {number} options.topK
 * @param {string|null} options.projectId - "all" for every project, a project id for scoped + global docs, null = all
 * @param {boolean} options.rewrite - LLM-rewrite the query before embedding
 */
export async function retrieveContext(
  query,
  { topK = 5, projectId = null, rewrite = false } = {},
) {
  const trimmed = query?.trim();
  if (!trimmed) return [];

  const docs = await readDocIndex();
  if (!docs.length) return [];

  const searchQuery = rewrite ? await rewriteSearchQuery(trimmed) : trimmed;
  const [queryVector] = await embedTexts([searchQuery]);
  const vectorIndex = getVectorIndex();

  if (vectorIndex) {
    // "all" or null = no filter (search every project's documents)
    let filter;
    if (projectId && projectId !== "global" && projectId !== "all") {
      filter = `projectId = '${projectId}' OR projectId = 'global'`;
    }

    const raw = await vectorIndex.query({
      vector: queryVector,
      topK: topK * 2,
      includeMetadata: true,
      ...(filter ? { filter } : {}),
    });

    return (raw || [])
      .filter((r) => r.metadata?.text && r.score >= SCORE_THRESHOLD)
      .slice(0, topK)
      .map((r) => ({
        title: r.metadata.title,
        text: r.metadata.text,
        score: r.score,
        projectId: r.metadata.projectId,
        docId: r.metadata.docId,
      }));
  }

  // Redis in-memory fallback (avoids loading everything for large corpora)
  const chunks = await readRedisChunks();
  const filtered =
    projectId && projectId !== "global" && projectId !== "all"
      ? chunks.filter(
          (c) => !c.projectId || c.projectId === "global" || c.projectId === projectId,
        )
      : chunks;

  return filtered
    .map((chunk) => ({
      title: chunk.title,
      text: chunk.text,
      score: cosineSimilarity(queryVector, chunk.vector),
      projectId: chunk.projectId,
      docId: chunk.docId,
    }))
    .filter((r) => r.score >= SCORE_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

export function isUsingVector() {
  return getVectorIndex() !== null;
}
