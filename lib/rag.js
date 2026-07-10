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
const CHUNK_OVERLAP_SENTENCES = 1; // sentences to carry forward as overlap
const SCORE_THRESHOLD = 0.25;
// Similarity above this = near-duplicate; skip second chunk in MMR dedup
const MMR_SIMILARITY_THRESHOLD = 0.88;

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
 * Split text into sentences on:
 *   - sentence-ending punctuation (. ! ?) followed by whitespace + next word
 *   - paragraph breaks (blank lines)
 * Each element is a trimmed, non-empty sentence or short paragraph.
 */
function splitSentences(text) {
  // Normalise paragraph breaks, then split
  const sentences = [];
  for (const para of text.split(/\n{2,}/)) {
    const trimmedPara = para.trim();
    if (!trimmedPara) continue;
    // Split on .!? followed by space where next char is uppercase or quote
    // This avoids splitting "e.g. foo" or "1.2 GHz" incorrectly
    const parts = trimmedPara.split(/(?<=[.!?])\s+(?=[A-Z"'(])/);
    for (const p of parts) {
      const s = p.trim();
      if (s) sentences.push(s);
    }
  }
  return sentences;
}

/**
 * Split markdown text into semantically meaningful chunks.
 * Strategy:
 *   1. Split on Markdown headings (# / ## / etc.) to preserve document structure.
 *   2. Within each section, group sentences greedily up to CHUNK_CHARS.
 *   3. Overlap: the last CHUNK_OVERLAP_SENTENCES sentence(s) of the flushed
 *      chunk are prepended to the next chunk to maintain context continuity.
 *   4. Single sentences longer than CHUNK_CHARS fall back to char-level splitting.
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

    // Section too large — split by sentences with sentence-level overlap
    const sentences = splitSentences(trimmed);
    let current = [];   // sentences in the current chunk
    let currentLen = 0;

    for (const sentence of sentences) {
      const addLen = (current.length ? 1 : 0) + sentence.length; // +1 for space separator

      if (currentLen + addLen <= CHUNK_CHARS) {
        current.push(sentence);
        currentLen += addLen;
      } else {
        if (current.length) {
          chunks.push(current.join(" "));
          // Overlap: carry the last N sentences into the next chunk
          const overlap = current.slice(-CHUNK_OVERLAP_SENTENCES);
          current = [...overlap];
          currentLen = overlap.join(" ").length;
        }

        if (sentence.length <= CHUNK_CHARS) {
          current.push(sentence);
          currentLen += (current.length > 1 ? 1 : 0) + sentence.length;
        } else {
          // Single sentence larger than CHUNK_CHARS — hard split with char overlap
          let start = 0;
          while (start < sentence.length) {
            const end = Math.min(start + CHUNK_CHARS, sentence.length);
            chunks.push(sentence.slice(start, end).trim());
            if (end >= sentence.length) break;
            start = Math.max(end - CHUNK_OVERLAP_CHARS, start + 1);
          }
          current = [];
          currentLen = 0;
        }
      }
    }

    if (current.length) chunks.push(current.join(" "));
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
 * Reassign all docs/chunks from one project to another (default: global).
 * Used when deleting a project so existing context remains usable.
 */
export async function reassignDocumentsProject(fromProjectId, toProjectId = "global") {
  const sourceId = String(fromProjectId || "").trim();
  const targetId = String(toProjectId || "global").trim() || "global";
  if (!sourceId) return { moved: 0 };
  if (sourceId === targetId) return { moved: 0 };

  const docs = await readDocIndex();
  const affected = docs.filter((d) => (d.projectId || "global") === sourceId);
  if (!affected.length) return { moved: 0 };

  const updatedDocs = docs.map((d) =>
    (d.projectId || "global") === sourceId ? { ...d, projectId: targetId } : d,
  );
  await writeDocIndex(updatedDocs);

  const vectorIndex = getVectorIndex();
  if (vectorIndex) {
    // Upstash Vector metadata cannot be bulk-updated by filter; re-upsert each
    // chunk with the same id and updated projectId metadata.
    for (const doc of affected) {
      const stored = await getDocumentMarkdown(doc.id);
      if (!stored?.markdown) continue;
      const chunks = chunkText(stored.markdown);
      if (!chunks.length) continue;
      const embeddings = await embedTexts(chunks);
      const records = chunks.map((text, i) => ({
        id: `${doc.id}:${i}`,
        vector: embeddings[i],
        metadata: {
          docId: doc.id,
          title: doc.title,
          chunkIndex: i,
          text,
          projectId: targetId,
        },
      }));
      await vectorIndex.upsert(records);
    }
  } else {
    const chunkDocIds = new Set(affected.map((d) => d.id));
    const chunks = await readRedisChunks();
    const updated = chunks.map((chunk) =>
      chunkDocIds.has(chunk.docId) ? { ...chunk, projectId: targetId } : chunk,
    );
    await writeRedisChunks(updated);
  }

  return { moved: affected.length, fromProjectId: sourceId, toProjectId: targetId };
}

/**
 * MMR-style text deduplication: given a ranked list of chunks, drop any chunk
 * whose text overlaps heavily (word-overlap ratio > threshold) with a
 * higher-ranked chunk that has already been selected.
 * This prevents the same fact from consuming multiple context slots.
 */
function deduplicateChunks(chunks) {
  const selected = [];
  for (const chunk of chunks) {
    const words = new Set(chunk.text.toLowerCase().split(/\W+/).filter(Boolean));
    const isDuplicate = selected.some((s) => {
      const sWords = new Set(s.text.toLowerCase().split(/\W+/).filter(Boolean));
      const intersection = [...words].filter((w) => sWords.has(w)).length;
      const overlap = intersection / Math.min(words.size, sWords.size);
      return overlap >= MMR_SIMILARITY_THRESHOLD;
    });
    if (!isDuplicate) selected.push(chunk);
  }
  return selected;
}

/**
 * Retrieve relevant chunks for a query.
 *
 * Improvements over naive retrieval:
 *   - Optional LLM query rewriting extracts the core topic before embedding.
 *   - Score threshold (SCORE_THRESHOLD) filters out irrelevant chunks.
 *   - Project scoping: returns chunks from the specified project + global ("unassigned") docs.
 *   - Over-fetches topK*3 then applies threshold + MMR dedup, so final count may be < topK.
 *   - MMR deduplication: near-duplicate chunks (word overlap >= MMR_SIMILARITY_THRESHOLD)
 *     are dropped so each context slot carries distinct information.
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

    // Over-fetch (topK*3) so dedup still yields topK distinct chunks
    const raw = await vectorIndex.query({
      vector: queryVector,
      topK: topK * 3,
      includeMetadata: true,
      ...(filter ? { filter } : {}),
    });

    const candidates = (raw || [])
      .filter((r) => r.metadata?.text && r.score >= SCORE_THRESHOLD)
      .map((r) => ({
        title: r.metadata.title,
        text: r.metadata.text,
        score: r.score,
        projectId: r.metadata.projectId,
        docId: r.metadata.docId,
      }));

    return deduplicateChunks(candidates).slice(0, topK);
  }

  // Redis in-memory fallback
  const chunks = await readRedisChunks();
  const filtered =
    projectId && projectId !== "global" && projectId !== "all"
      ? chunks.filter(
          (c) => !c.projectId || c.projectId === "global" || c.projectId === projectId,
        )
      : chunks;

  const candidates = filtered
    .map((chunk) => ({
      title: chunk.title,
      text: chunk.text,
      score: cosineSimilarity(queryVector, chunk.vector),
      projectId: chunk.projectId,
      docId: chunk.docId,
    }))
    .filter((r) => r.score >= SCORE_THRESHOLD)
    .sort((a, b) => b.score - a.score);

  return deduplicateChunks(candidates).slice(0, topK);
}

export function isUsingVector() {
  return getVectorIndex() !== null;
}
