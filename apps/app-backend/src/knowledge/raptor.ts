/**
 * RAPTOR (Recursive Abstractive Processing for Tree-Organized Retrieval)
 *
 * This module implements RAPTOR, a technique for building hierarchical
 * summary trees from document chunks. The tree enables retrieval at
 * multiple levels of abstraction.
 *
 * How it works:
 * 1. Start with leaf nodes (original document chunks)
 * 2. Group leaves into clusters
 * 3. Generate summaries for each cluster
 * 4. Repeat until reaching the root
 *
 * Retrieval traverses from root to leaves, using embeddings to
 * navigate towards relevant content.
 */

import { query } from "../db/postgres.js";
import { llmGateway, configStore, type LLMProviderId } from "../llm/index.js";
import type { RaptorNode, IndexSearchResult } from "./types.js";

// ============================================================
// Configuration
// ============================================================

const CLUSTER_SIZE = 5; // Number of nodes to cluster together
const MAX_TREE_LEVELS = 4; // Maximum tree depth
const SUMMARY_MAX_LENGTH = 500;
const EMBEDDING_BATCH_SIZE = 20;

// ============================================================
// Embedding Helpers
// ============================================================

let embeddingConfigCache: { config: unknown; timestamp: number } | null = null;
const CACHE_TTL = 60000;

async function getEmbeddingConfig(): Promise<{
  providerId: LLMProviderId;
  model: string;
} | null> {
  const now = Date.now();
  if (embeddingConfigCache && now - embeddingConfigCache.timestamp < CACHE_TTL) {
    return embeddingConfigCache.config as { providerId: LLMProviderId; model: string };
  }

  const config = await configStore.getInternalByType("embedding");
  if (!config || !config.enabled) {
    return null;
  }

  const result = {
    providerId: config.providerId as LLMProviderId,
    model: config.defaultModel || "text-embedding-3-small",
  };

  embeddingConfigCache = { config: result, timestamp: now };
  return result;
}

async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const config = await getEmbeddingConfig();
  if (!config) {
    throw new Error("No embedding provider configured");
  }

  const results: number[][] = [];

  // Process in batches
  for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBEDDING_BATCH_SIZE);
    const response = await llmGateway.generateEmbeddings({
      provider: config.providerId,
      model: config.model,
      inputs: batch,
    });
    results.push(...response.embeddings);
  }

  return results;
}

function formatVector(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ============================================================
// RAPTOR Tree Building
// ============================================================

/**
 * Build a RAPTOR tree from document chunks
 */
export async function buildRaptorTree(
  userId: string,
  projectKey: string,
  docId: string,
  chunks: Array<{ id: string; content: string }>,
): Promise<void> {
  if (chunks.length === 0) return;

  console.log(`[RAPTOR] Building tree for doc ${docId} with ${chunks.length} chunks`);

  // Clear existing tree for this document
  await clearRaptorTree(userId, projectKey, docId);

  // Step 1: Create leaf nodes with embeddings
  const leafEmbeddings = await generateEmbeddings(chunks.map((c) => c.content));

  const leafNodes: RaptorNode[] = chunks.map((chunk, idx) => ({
    id: `${docId}:raptor:leaf:${chunk.id}`,
    user_id: userId,
    project_key: projectKey,
    doc_id: docId,
    level: 0,
    content: chunk.content,
    embedding: leafEmbeddings[idx],
    children: [],
    created_at: Date.now(),
  }));

  // Insert leaf nodes
  await insertRaptorNodes(leafNodes);

  // Step 2: Build higher levels recursively
  let currentLevel = leafNodes;
  let levelNum = 1;

  while (currentLevel.length > 1 && levelNum <= MAX_TREE_LEVELS) {
    const nextLevel = await buildNextLevel(
      userId,
      projectKey,
      docId,
      currentLevel,
      levelNum,
    );

    if (nextLevel.length === 0) break;

    await insertRaptorNodes(nextLevel);
    currentLevel = nextLevel;
    levelNum++;
  }

  console.log(`[RAPTOR] Tree built with ${levelNum} levels`);
}

/**
 * Build the next level of the RAPTOR tree
 */
async function buildNextLevel(
  userId: string,
  projectKey: string,
  docId: string,
  currentLevel: RaptorNode[],
  levelNum: number,
): Promise<RaptorNode[]> {
  const nextLevel: RaptorNode[] = [];

  // Cluster nodes
  const clusters = clusterNodes(currentLevel, CLUSTER_SIZE);

  for (let clusterIdx = 0; clusterIdx < clusters.length; clusterIdx++) {
    const cluster = clusters[clusterIdx];

    // Generate summary for the cluster
    const combinedContent = cluster.map((n) => n.content).join("\n\n---\n\n");
    const summary = await generateSummary(combinedContent);

    if (!summary) continue;

    // Generate embedding for the summary
    const [embedding] = await generateEmbeddings([summary]);

    const node: RaptorNode = {
      id: `${docId}:raptor:L${levelNum}:${clusterIdx}`,
      user_id: userId,
      project_key: projectKey,
      doc_id: docId,
      level: levelNum,
      content: summary,
      embedding,
      children: cluster.map((n) => n.id),
      created_at: Date.now(),
    };

    nextLevel.push(node);
  }

  return nextLevel;
}

/**
 * Cluster nodes into groups of similar size
 */
function clusterNodes(nodes: RaptorNode[], clusterSize: number): RaptorNode[][] {
  if (nodes.length <= clusterSize) {
    return [nodes];
  }

  // Simple sequential clustering for now
  // TODO: Consider semantic clustering using embeddings
  const clusters: RaptorNode[][] = [];

  for (let i = 0; i < nodes.length; i += clusterSize) {
    clusters.push(nodes.slice(i, i + clusterSize));
  }

  return clusters;
}

/**
 * Generate a summary for a cluster of content
 */
async function generateSummary(content: string): Promise<string | null> {
  const config = await configStore.getInternalByType("llm");
  if (!config || !config.enabled) {
    // Fallback: truncate content
    return content.slice(0, SUMMARY_MAX_LENGTH);
  }

  try {
    const response = await llmGateway.chat({
      provider: config.providerId as LLMProviderId,
      model: config.defaultModel || "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Generate a concise summary that captures the key information from the following content. The summary should be comprehensive enough to be useful for retrieval but concise (max ${SUMMARY_MAX_LENGTH} characters). Output only the summary, no preamble.`,
        },
        {
          role: "user",
          content: content.slice(0, 4000), // Limit input to avoid token limits
        },
      ],
      temperature: 0,
      maxTokens: 200,
    });

    const summary = response.content.trim();
    return summary.slice(0, SUMMARY_MAX_LENGTH);
  } catch (err) {
    console.warn("[RAPTOR] Summary generation failed:", err);
    return content.slice(0, SUMMARY_MAX_LENGTH);
  }
}

// ============================================================
// RAPTOR Tree Search
// ============================================================

/**
 * Search the RAPTOR tree, traversing from high-level summaries to leaves
 */
export async function searchRaptorTree(
  userId: string,
  projectKey: string,
  queryText: string,
  docIds?: string[],
  options: {
    limit?: number;
    expandLevel?: number; // How many levels to expand from top match
  } = {},
): Promise<IndexSearchResult[]> {
  const { limit = 10, expandLevel = 2 } = options;

  // Generate query embedding
  const [queryEmbedding] = await generateEmbeddings([queryText]);

  // Get all nodes (we'll do the traversal in memory for now)
  const allNodes = await getRaptorNodes(userId, projectKey, docIds);

  if (allNodes.length === 0) {
    return [];
  }

  // Group nodes by level
  const byLevel = new Map<number, RaptorNode[]>();
  for (const node of allNodes) {
    const nodes = byLevel.get(node.level) || [];
    nodes.push(node);
    byLevel.set(node.level, nodes);
  }

  const maxLevel = Math.max(...byLevel.keys());

  // Start from the highest level
  const results: IndexSearchResult[] = [];
  const targetNodeIds = new Set<string>();

  // Search from top level down
  for (let level = maxLevel; level >= 0; level--) {
    const levelNodes = byLevel.get(level) || [];

    // Filter to nodes we should search (either all at top level, or children of targets)
    const searchNodes =
      level === maxLevel
        ? levelNodes
        : levelNodes.filter(
            (n) =>
              targetNodeIds.size === 0 ||
              n.children?.some((c) => targetNodeIds.has(c)),
          );

    if (searchNodes.length === 0) continue;

    // Score nodes by similarity
    const scored = searchNodes
      .filter((n) => n.embedding && n.embedding.length > 0)
      .map((n) => ({
        node: n,
        score: cosineSimilarity(queryEmbedding, n.embedding!),
      }))
      .sort((a, b) => b.score - a.score);

    // Take top results at this level
    const topK = Math.max(1, Math.ceil(limit / (maxLevel - level + 1)));
    const topNodes = scored.slice(0, topK);

    // Add to results
    for (const { node, score } of topNodes) {
      results.push({
        id: node.id,
        doc_id: node.doc_id,
        content: node.content,
        score,
        granularity: level === 0 ? "block" : "section",
        metadata: {
          raptor_level: node.level,
          children: node.children,
        },
      });

      // Mark children for expansion
      if (node.children) {
        for (const childId of node.children) {
          targetNodeIds.add(childId);
        }
      }
    }

    // Stop if we've expanded enough levels
    if (maxLevel - level >= expandLevel) {
      break;
    }
  }

  // Sort by score and return top results
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

// ============================================================
// Database Operations
// ============================================================

async function insertRaptorNodes(nodes: RaptorNode[]): Promise<void> {
  for (const node of nodes) {
    const embeddingStr = node.embedding ? formatVector(node.embedding) : null;

    await query(
      `INSERT INTO raptor_tree (
        id, user_id, project_key, doc_id, level, parent_id, children, content, embedding, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector, to_timestamp($10/1000.0))
      ON CONFLICT (id) DO UPDATE SET
        content = EXCLUDED.content,
        embedding = EXCLUDED.embedding,
        children = EXCLUDED.children`,
      [
        node.id,
        node.user_id,
        node.project_key,
        node.doc_id,
        node.level,
        null, // parent_id is not used in this implementation
        node.children,
        node.content,
        embeddingStr,
        node.created_at,
      ],
    );
  }
}

async function getRaptorNodes(
  userId: string,
  projectKey: string,
  docIds?: string[],
): Promise<RaptorNode[]> {
  let sql = `
    SELECT id, user_id, project_key, doc_id, level, parent_id, children, content, embedding,
           EXTRACT(EPOCH FROM created_at) * 1000 as created_at
    FROM raptor_tree
    WHERE user_id = $1 AND project_key = $2
  `;
  const params: unknown[] = [userId, projectKey];

  if (docIds && docIds.length > 0) {
    sql += " AND doc_id = ANY($3)";
    params.push(docIds);
  }

  sql += " ORDER BY level DESC, id";

  const result = await query<{
    id: string;
    user_id: string;
    project_key: string;
    doc_id: string;
    level: number;
    parent_id: string | null;
    children: string[];
    content: string;
    embedding: string | null;
    created_at: number;
  }>(sql, params);

  return result.rows.map((row) => ({
    id: row.id,
    user_id: row.user_id,
    project_key: row.project_key,
    doc_id: row.doc_id,
    level: row.level,
    content: row.content,
    embedding: row.embedding ? parseVector(row.embedding) : undefined,
    children: row.children || [],
    created_at: row.created_at,
  }));
}

function parseVector(vectorStr: string): number[] {
  // PostgreSQL vector format: [1,2,3,...]
  const cleaned = vectorStr.replace(/[\[\]]/g, "");
  return cleaned.split(",").map(Number);
}

/**
 * Clear RAPTOR tree for a document
 */
export async function clearRaptorTree(
  userId: string,
  projectKey: string,
  docId: string,
): Promise<void> {
  await query(
    `DELETE FROM raptor_tree WHERE user_id = $1 AND project_key = $2 AND doc_id = $3`,
    [userId, projectKey, docId],
  );
}

/**
 * Clear all RAPTOR trees for a project
 */
export async function clearProjectRaptorTrees(
  userId: string,
  projectKey: string,
): Promise<void> {
  await query(
    `DELETE FROM raptor_tree WHERE user_id = $1 AND project_key = $2`,
    [userId, projectKey],
  );
}

/**
 * Get RAPTOR tree statistics
 */
export async function getRaptorStats(
  userId: string,
  projectKey: string,
): Promise<{
  totalNodes: number;
  documentCount: number;
  levelCounts: Record<number, number>;
}> {
  const result = await query<{
    level: number;
    count: string;
    doc_count: string;
  }>(
    `SELECT level, COUNT(*) as count, COUNT(DISTINCT doc_id) as doc_count
     FROM raptor_tree
     WHERE user_id = $1 AND project_key = $2
     GROUP BY level
     ORDER BY level`,
    [userId, projectKey],
  );

  const levelCounts: Record<number, number> = {};
  let totalNodes = 0;
  let documentCount = 0;

  for (const row of result.rows) {
    levelCounts[row.level] = parseInt(row.count, 10);
    totalNodes += parseInt(row.count, 10);
    if (row.level === 0) {
      documentCount = parseInt(row.doc_count, 10);
    }
  }

  return { totalNodes, documentCount, levelCounts };
}
