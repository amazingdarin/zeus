/**
 * Multi-Granularity Index Store
 *
 * This module provides storage and retrieval operations for the unified
 * knowledge index table supporting multiple granularity levels.
 */

import { query } from "../db/postgres.js";
import type { Document } from "../storage/types.js";
import type {
  IndexEntry,
  IndexGranularity,
  IndexSearchOptions,
  IndexSearchResult,
  ChunkResult,
} from "./types.js";
import { chunkDocument, flattenChunkResult } from "./chunker-v2.js";
import {
  llmGateway,
  configStore,
  type LLMProviderId,
  type ProviderConfigInternal,
} from "../llm/index.js";

// ============================================================
// Configuration
// ============================================================

let cachedEmbeddingConfig: ProviderConfigInternal | null | undefined = undefined;
let configLastChecked = 0;
const CONFIG_CACHE_TTL = 60000; // 1 minute

// ============================================================
// Embedding Helpers
// ============================================================

async function getEmbeddingConfig(): Promise<ProviderConfigInternal | null> {
  const now = Date.now();
  if (cachedEmbeddingConfig !== undefined && now - configLastChecked < CONFIG_CACHE_TTL) {
    return cachedEmbeddingConfig;
  }

  try {
    cachedEmbeddingConfig = await configStore.getInternalByType("embedding");
    configLastChecked = now;
    return cachedEmbeddingConfig;
  } catch (err) {
    console.warn("[IndexStore] Failed to get embedding config:", err);
    return null;
  }
}

export function clearEmbeddingConfigCache(): void {
  cachedEmbeddingConfig = undefined;
  configLastChecked = 0;
}

async function generateEmbeddings(inputs: string[]): Promise<number[][]> {
  if (inputs.length === 0) return [];

  const config = await getEmbeddingConfig();
  if (!config || !config.enabled) {
    // Let callers decide how to degrade if embeddings are unavailable.
    throw new Error("No embedding provider configured");
  }

  const provider = config.providerId as LLMProviderId;
  const model = config.defaultModel || "text-embedding-3-small";

  try {
    const result = await llmGateway.generateEmbeddings({
      provider,
      model,
      inputs,
    });
    return result.embeddings;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Embedding generation failed: ${message}`);
  }
}

function formatVector(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

// ============================================================
// Language Detection
// ============================================================

function detectLanguage(text: string): "english" | "zhparser" {
  for (const char of text) {
    if (char.charCodeAt(0) > 127) {
      return "zhparser";
    }
  }
  return "english";
}

// ============================================================
// Index Store Implementation
// ============================================================

export const indexStore = {
  /**
   * Index a document at all granularity levels
   */
  async indexDocument(
    userId: string,
    projectKey: string,
    doc: Document,
    parentPath: string[] = [],
  ): Promise<{ indexed: number; errors: string[] }> {
    if (!userId || !projectKey || !doc?.meta?.id) {
      throw new Error("Invalid parameters for indexDocument");
    }

    const errors: string[] = [];
    const chunks = chunkDocument(userId, projectKey, doc, parentPath);
    const entries = flattenChunkResult(chunks);

    if (entries.length === 0) {
      return { indexed: 0, errors: [] };
    }

    // Generate embeddings for all entries
    const contents = entries.map((e) => e.content);
    let embeddings: number[][] = [];

    try {
      embeddings = await generateEmbeddings(contents);
    } catch (err) {
      errors.push(`Embedding generation failed: ${err instanceof Error ? err.message : String(err)}`);
      // Continue without embeddings - full-text search will still work
    }

    // Delete existing entries for this document
    await this.removeDocument(userId, projectKey, doc.meta.id);

    // Insert new entries
    let indexed = 0;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const embedding = embeddings[i] || null;

      try {
        await this.upsertEntry(entry, embedding);
        indexed++;
      } catch (err) {
        errors.push(
          `Failed to index entry ${entry.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return { indexed, errors };
  },

  /**
   * Upsert a single index entry
   */
  async upsertEntry(entry: IndexEntry, embedding?: number[] | null): Promise<void> {
    const embeddingStr = embedding ? formatVector(embedding) : null;

    await query(
      `INSERT INTO knowledge_index (
        id, user_id, project_key, doc_id, granularity,
        content, embedding, metadata, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::vector, $8, to_timestamp($9/1000.0), to_timestamp($10/1000.0))
      ON CONFLICT (id) DO UPDATE SET
        content = EXCLUDED.content,
        embedding = EXCLUDED.embedding,
        metadata = EXCLUDED.metadata,
        updated_at = EXCLUDED.updated_at`,
      [
        entry.id,
        entry.user_id,
        entry.project_key,
        entry.doc_id,
        entry.granularity,
        entry.content,
        embeddingStr,
        JSON.stringify(entry.metadata),
        entry.created_at,
        entry.updated_at,
      ],
    );
  },

  /**
   * Remove all entries for a document
   */
  async removeDocument(
    userId: string,
    projectKey: string,
    docId: string,
  ): Promise<number> {
    const result = await query(
      `DELETE FROM knowledge_index
       WHERE user_id = $1 AND project_key = $2 AND doc_id = $3
       RETURNING id`,
      [userId, projectKey, docId],
    );
    return result.rowCount || 0;
  },

  /**
   * Remove all entries for a project
   */
  async removeProject(userId: string, projectKey: string): Promise<number> {
    const result = await query(
      `DELETE FROM knowledge_index
       WHERE user_id = $1 AND project_key = $2
       RETURNING id`,
      [userId, projectKey],
    );
    return result.rowCount || 0;
  },

  /**
   * Search using vector similarity
   */
  async searchByVector(
    userId: string,
    projectKey: string,
    queryText: string,
    options: IndexSearchOptions = {},
  ): Promise<IndexSearchResult[]> {
    const {
      granularities,
      docIds,
      limit = 20,
      offset = 0,
      vector,
      minScore = 0,
    } = options;

    // Generate query embedding if not provided
    let queryVector = vector;
    if (!queryVector || queryVector.length === 0) {
      if (!queryText.trim()) {
        return [];
      }
      try {
        const embeddings = await generateEmbeddings([queryText]);
        if (embeddings.length === 0) {
          return [];
        }
        queryVector = embeddings[0];
      } catch (err) {
        // No embedding provider configured (or provider error). Treat as "no vector search".
        console.warn("[IndexStore] Vector search unavailable:", err);
        return [];
      }
    }

    // Build WHERE clause
    const conditions: string[] = [
      "user_id = $1",
      "project_key = $2",
      "embedding IS NOT NULL",
    ];
    const params: unknown[] = [userId, projectKey];
    let paramIndex = 3;

    if (granularities && granularities.length > 0) {
      conditions.push(`granularity = ANY($${paramIndex})`);
      params.push(granularities);
      paramIndex++;
    }

    if (docIds && docIds.length > 0) {
      conditions.push(`doc_id = ANY($${paramIndex})`);
      params.push(docIds);
      paramIndex++;
    }

    params.push(formatVector(queryVector));
    const vectorParam = paramIndex++;

    if (minScore > 0) {
      conditions.push(`1 - (embedding <=> $${vectorParam}::vector) >= $${paramIndex}`);
      params.push(minScore);
      paramIndex++;
    }

    params.push(limit);
    const limitParam = paramIndex++;
    params.push(offset);
    const offsetParam = paramIndex++;

    const sql = `
      SELECT
        id,
        doc_id,
        granularity,
        content,
        1 - (embedding <=> $${vectorParam}::vector) as score,
        metadata
      FROM knowledge_index
      WHERE ${conditions.join(" AND ")}
      ORDER BY embedding <=> $${vectorParam}::vector
      LIMIT $${limitParam} OFFSET $${offsetParam}
    `;

    const result = await query<{
      id: string;
      doc_id: string;
      granularity: IndexGranularity;
      content: string;
      score: number;
      metadata: Record<string, unknown>;
    }>(sql, params);

    return result.rows.map((row) => ({
      id: row.id,
      doc_id: row.doc_id,
      block_id: row.metadata?.block_id as string | undefined,
      content: row.content,
      score: row.score,
      granularity: row.granularity,
      metadata: row.metadata as IndexSearchResult["metadata"],
    }));
  },

  /**
   * Search using full-text search
   */
  async searchByFulltext(
    userId: string,
    projectKey: string,
    queryText: string,
    options: IndexSearchOptions = {},
  ): Promise<IndexSearchResult[]> {
    const { granularities, docIds, limit = 20, offset = 0 } = options;

    if (!queryText.trim()) {
      return [];
    }

    const lang = detectLanguage(queryText);
    const tsvColumn = lang === "zhparser" ? "tsv_zh" : "tsv_en";
    const config = lang === "zhparser" ? "zhparser" : "english";

    // Build WHERE clause
    const conditions: string[] = [
      "user_id = $1",
      "project_key = $2",
      `${tsvColumn} @@ plainto_tsquery('${config}', $3)`,
    ];
    const params: unknown[] = [userId, projectKey, queryText];
    let paramIndex = 4;

    if (granularities && granularities.length > 0) {
      conditions.push(`granularity = ANY($${paramIndex})`);
      params.push(granularities);
      paramIndex++;
    }

    if (docIds && docIds.length > 0) {
      conditions.push(`doc_id = ANY($${paramIndex})`);
      params.push(docIds);
      paramIndex++;
    }

    params.push(limit);
    const limitParam = paramIndex++;
    params.push(offset);
    const offsetParam = paramIndex++;

    const sql = `
      SELECT
        id,
        doc_id,
        granularity,
        content,
        ts_rank(${tsvColumn}, plainto_tsquery('${config}', $3)) as score,
        metadata
      FROM knowledge_index
      WHERE ${conditions.join(" AND ")}
      ORDER BY score DESC
      LIMIT $${limitParam} OFFSET $${offsetParam}
    `;

    const result = await query<{
      id: string;
      doc_id: string;
      granularity: IndexGranularity;
      content: string;
      score: number;
      metadata: Record<string, unknown>;
    }>(sql, params);

    return result.rows.map((row) => ({
      id: row.id,
      doc_id: row.doc_id,
      block_id: row.metadata?.block_id as string | undefined,
      content: row.content,
      score: row.score,
      granularity: row.granularity,
      metadata: row.metadata as IndexSearchResult["metadata"],
    }));
  },

  /**
   * Hybrid search combining vector and full-text
   */
  async searchHybrid(
    userId: string,
    projectKey: string,
    queryText: string,
    options: IndexSearchOptions = {},
  ): Promise<IndexSearchResult[]> {
    const { limit = 20 } = options;

    // Run both searches in parallel
    const [vectorResults, fulltextResults] = await Promise.all([
      this.searchByVector(userId, projectKey, queryText, {
        ...options,
        limit: limit * 2,
      }),
      this.searchByFulltext(userId, projectKey, queryText, {
        ...options,
        limit: limit * 2,
      }),
    ]);

    // If vector search isn't available, just return full-text results.
    if (vectorResults.length === 0) {
      return fulltextResults.slice(0, limit);
    }

    // If full-text doesn't return anything, return vector results.
    if (fulltextResults.length === 0) {
      return vectorResults.slice(0, limit);
    }

    // Reciprocal Rank Fusion
    return this.reciprocalRankFusion(
      [vectorResults, fulltextResults],
      limit,
    );
  },

  /**
   * Reciprocal Rank Fusion for combining multiple result sets
   */
  reciprocalRankFusion(
    resultSets: IndexSearchResult[][],
    limit: number,
    k: number = 60,
  ): IndexSearchResult[] {
    const scores = new Map<string, { score: number; result: IndexSearchResult }>();

    for (const results of resultSets) {
      for (let rank = 0; rank < results.length; rank++) {
        const result = results[rank];
        const rrfScore = 1 / (k + rank + 1);

        const existing = scores.get(result.id);
        if (existing) {
          existing.score += rrfScore;
        } else {
          scores.set(result.id, { score: rrfScore, result });
        }
      }
    }

    // Sort by combined score and return top results
    const sorted = [...scores.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return sorted.map(({ score, result }) => ({
      ...result,
      score,
    }));
  },

  /**
   * Get entries by document ID
   */
  async getByDocument(
    userId: string,
    projectKey: string,
    docId: string,
    granularities?: IndexGranularity[],
  ): Promise<IndexEntry[]> {
    let sql = `
      SELECT id, user_id, project_key, doc_id, granularity,
             content, metadata, 
             EXTRACT(EPOCH FROM created_at) * 1000 as created_at,
             EXTRACT(EPOCH FROM updated_at) * 1000 as updated_at
      FROM knowledge_index
      WHERE user_id = $1 AND project_key = $2 AND doc_id = $3
    `;
    const params: unknown[] = [userId, projectKey, docId];

    if (granularities && granularities.length > 0) {
      sql += " AND granularity = ANY($4)";
      params.push(granularities);
    }

    sql += " ORDER BY granularity, id";

    const result = await query<{
      id: string;
      user_id: string;
      project_key: string;
      doc_id: string;
      granularity: IndexGranularity;
      content: string;
      metadata: Record<string, unknown>;
      created_at: number;
      updated_at: number;
    }>(sql, params);

    return result.rows.map((row) => ({
      id: row.id,
      user_id: row.user_id,
      project_key: row.project_key,
      doc_id: row.doc_id,
      granularity: row.granularity,
      content: row.content,
      metadata: row.metadata as IndexEntry["metadata"],
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  },

  /**
   * Get index statistics
   */
  async getStats(
    userId: string,
    projectKey: string,
  ): Promise<{
    totalEntries: number;
    byGranularity: Record<IndexGranularity, number>;
    documentCount: number;
  }> {
    const result = await query<{
      granularity: IndexGranularity;
      count: string;
    }>(
      `SELECT granularity, COUNT(*) as count
       FROM knowledge_index
       WHERE user_id = $1 AND project_key = $2
       GROUP BY granularity`,
      [userId, projectKey],
    );

    const byGranularity: Record<IndexGranularity, number> = {
      document: 0,
      section: 0,
      block: 0,
      code: 0,
    };

    for (const row of result.rows) {
      byGranularity[row.granularity] = parseInt(row.count, 10);
    }

    const totalEntries = Object.values(byGranularity).reduce((a, b) => a + b, 0);

    const docResult = await query<{ count: string }>(
      `SELECT COUNT(DISTINCT doc_id) as count
       FROM knowledge_index
       WHERE user_id = $1 AND project_key = $2`,
      [userId, projectKey],
    );

    return {
      totalEntries,
      byGranularity,
      documentCount: parseInt(docResult.rows[0]?.count || "0", 10),
    };
  },
};
