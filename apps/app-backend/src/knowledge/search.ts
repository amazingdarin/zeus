import type { Document, SearchQuery, SearchResult } from "../storage/types.js";
import { buildCacheKey } from "../storage/paths.js";
import { fulltextIndex } from "./fulltext-index.js";
import { embeddingIndex, clearEmbeddingConfigCache } from "./embedding-index.js";

export type SearchMode = "fulltext" | "embedding" | "hybrid";

export type RebuildProgress = {
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  errors: Array<{ docId: string; error: string }>;
};

/**
 * Unified knowledge search service
 */
export const knowledgeSearch = {
  /**
   * Search knowledge base with specified mode
   */
  async search(
    userId: string,
    projectKey: string,
    query: SearchQuery,
  ): Promise<SearchResult[]> {
    const cacheKey = buildCacheKey(userId, projectKey);
    const mode = query.mode || "hybrid";
    const text = query.text?.trim() || "";
    const limit = query.limit || 20;
    const offset = query.offset || 0;
    const docIds = query.doc_ids;

    if (!text && (!query.vector || query.vector.length === 0)) {
      return [];
    }

    switch (mode) {
      case "fulltext":
        if (query.fuzzy) {
          return fulltextIndex.fuzzySearch(cacheKey, cacheKey, text, {
            minSimilarity: query.min_similarity,
            limit,
            offset,
          });
        }
        return fulltextIndex.search(cacheKey, cacheKey, text, {
          limit,
          offset,
          highlight: query.highlight,
          sortBy: query.sort_by,
          filters: query.filters,
          docIds,
        });

      case "embedding":
        return embeddingIndex.search(cacheKey, cacheKey, text, {
          limit,
          offset,
          vector: query.vector,
          docIds,
        });

      case "hybrid":
      default:
        return hybridSearch(cacheKey, cacheKey, text, { limit, offset, docIds });
    }
  },

  /**
   * Index a document (both fulltext and embedding)
   */
  async indexDocument(userId: string, projectKey: string, doc: Document): Promise<void> {
    const cacheKey = buildCacheKey(userId, projectKey);

    await Promise.all([
      fulltextIndex.upsert(cacheKey, cacheKey, doc),
      embeddingIndex.upsert(cacheKey, cacheKey, doc).catch((err) => {
        // Embedding might fail if API is not available, log but don't throw
        console.error("Embedding index error:", err);
      }),
    ]);
  },

  /**
   * Remove a document from indexes
   */
  async removeDocument(userId: string, projectKey: string, docId: string): Promise<void> {
    const cacheKey = buildCacheKey(userId, projectKey);

    await Promise.all([
      fulltextIndex.remove(cacheKey, cacheKey, docId),
      embeddingIndex.remove(cacheKey, cacheKey, docId),
    ]);
  },

  /**
   * Rebuild indexes for all documents in a project
   */
  async rebuildAll(
    userId: string,
    projectKey: string,
    documents: Document[],
    onProgress?: (progress: RebuildProgress) => void,
  ): Promise<RebuildProgress> {
    const cacheKey = buildCacheKey(userId, projectKey);
    const progress: RebuildProgress = {
      total: documents.length,
      processed: 0,
      succeeded: 0,
      failed: 0,
      errors: [],
    };

    // Clear embedding config cache to get fresh settings
    clearEmbeddingConfigCache();

    // First, clear all existing indexes for this project
    await Promise.all([
      fulltextIndex.removeByIndex(cacheKey, cacheKey),
      embeddingIndex.removeByIndex?.(cacheKey, cacheKey).catch(() => {}),
    ]);

    // Index each document
    for (const doc of documents) {
      try {
        await this.indexDocument(userId, projectKey, doc);
        progress.succeeded++;
      } catch (err) {
        progress.failed++;
        progress.errors.push({
          docId: doc.meta.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      progress.processed++;
      onProgress?.(progress);
    }

    return progress;
  },

  /**
   * Rebuild index for a single document
   */
  async rebuildDocument(userId: string, projectKey: string, doc: Document): Promise<void> {
    // Clear embedding config cache to get fresh settings
    clearEmbeddingConfigCache();
    
    // Remove existing index entries first
    await this.removeDocument(userId, projectKey, doc.meta.id);
    
    // Re-index
    await this.indexDocument(userId, projectKey, doc);
  },
};

// Maximum blocks per document in search results
const MAX_BLOCKS_PER_DOC = 3;

/**
 * Create a unique key for doc+block combination
 */
function makeBlockKey(docId: string, blockId?: string): string {
  return blockId ? `${docId}::${blockId}` : docId;
}

/**
 * Hybrid search combining fulltext and embedding results
 */
async function hybridSearch(
  projectKey: string,
  indexName: string,
  text: string,
  options: { limit: number; offset: number; docIds?: string[] },
): Promise<SearchResult[]> {
  const { limit, offset, docIds } = options;

  // Get more results than needed for merging
  const fetchLimit = Math.max(limit * 3, 60);

  // Run both searches in parallel
  const [fulltextResults, embeddingResults] = await Promise.all([
    fulltextIndex.search(projectKey, indexName, text, {
      limit: fetchLimit,
      offset: 0,
      highlight: true,
      docIds,
    }),
    embeddingIndex.search(projectKey, indexName, text, {
      limit: fetchLimit,
      offset: 0,
      docIds,
    }).catch(() => [] as SearchResult[]), // Fallback if embedding fails
  ]);

  // Merge and deduplicate results using RRF (Reciprocal Rank Fusion)
  // Use doc_id + block_id as key to preserve block-level granularity
  const scores = new Map<string, { score: number; result: SearchResult }>();
  const k = 60; // RRF constant

  // Process fulltext results (fulltext doesn't have block_id, so use doc_id only)
  for (let i = 0; i < fulltextResults.length; i++) {
    const r = fulltextResults[i];
    const key = makeBlockKey(r.doc_id, r.block_id);
    const rrfScore = 1 / (k + i + 1);
    const existing = scores.get(key);
    if (existing) {
      existing.score += rrfScore;
    } else {
      scores.set(key, { score: rrfScore, result: r });
    }
  }

  // Process embedding results (has block_id)
  for (let i = 0; i < embeddingResults.length; i++) {
    const r = embeddingResults[i];
    const key = makeBlockKey(r.doc_id, r.block_id);
    const rrfScore = 1 / (k + i + 1);
    const existing = scores.get(key);
    if (existing) {
      existing.score += rrfScore;
    } else {
      scores.set(key, { score: rrfScore, result: r });
    }
  }

  // Sort by combined score
  const sorted = [...scores.values()].sort((a, b) => b.score - a.score);

  // Limit blocks per document to avoid one document dominating results
  const docBlockCounts = new Map<string, number>();
  const filtered: Array<{ score: number; result: SearchResult }> = [];

  for (const entry of sorted) {
    const docId = entry.result.doc_id;
    const currentCount = docBlockCounts.get(docId) || 0;
    if (currentCount < MAX_BLOCKS_PER_DOC) {
      filtered.push(entry);
      docBlockCounts.set(docId, currentCount + 1);
    }
  }

  // Apply pagination and return
  return filtered.slice(offset, offset + limit).map(({ score, result }) => ({
    ...result,
    score,
  }));
}
