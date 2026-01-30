import type { Document, SearchQuery, SearchResult } from "../storage/types.js";
import { fulltextIndex } from "./fulltext-index.js";
import { embeddingIndex } from "./embedding-index.js";

export type SearchMode = "fulltext" | "embedding" | "hybrid";

/**
 * Unified knowledge search service
 */
export const knowledgeSearch = {
  /**
   * Search knowledge base with specified mode
   */
  async search(
    projectKey: string,
    indexName: string,
    query: SearchQuery,
  ): Promise<SearchResult[]> {
    const mode = query.mode || "hybrid";
    const text = query.text?.trim() || "";
    const limit = query.limit || 20;
    const offset = query.offset || 0;

    if (!text && (!query.vector || query.vector.length === 0)) {
      return [];
    }

    switch (mode) {
      case "fulltext":
        if (query.fuzzy) {
          return fulltextIndex.fuzzySearch(projectKey, indexName, text, {
            minSimilarity: query.min_similarity,
            limit,
            offset,
          });
        }
        return fulltextIndex.search(projectKey, indexName, text, {
          limit,
          offset,
          highlight: query.highlight,
          sortBy: query.sort_by,
          filters: query.filters,
        });

      case "embedding":
        return embeddingIndex.search(projectKey, indexName, text, {
          limit,
          offset,
          vector: query.vector,
        });

      case "hybrid":
      default:
        return hybridSearch(projectKey, indexName, text, { limit, offset });
    }
  },

  /**
   * Index a document (both fulltext and embedding)
   */
  async indexDocument(projectKey: string, doc: Document): Promise<void> {
    const indexName = projectKey; // Use project key as index name

    await Promise.all([
      fulltextIndex.upsert(projectKey, indexName, doc),
      embeddingIndex.upsert(projectKey, indexName, doc).catch((err) => {
        // Embedding might fail if API is not available, log but don't throw
        console.error("Embedding index error:", err);
      }),
    ]);
  },

  /**
   * Remove a document from indexes
   */
  async removeDocument(projectKey: string, docId: string): Promise<void> {
    const indexName = projectKey;

    await Promise.all([
      fulltextIndex.remove(projectKey, indexName, docId),
      embeddingIndex.remove(projectKey, indexName, docId),
    ]);
  },
};

/**
 * Hybrid search combining fulltext and embedding results
 */
async function hybridSearch(
  projectKey: string,
  indexName: string,
  text: string,
  options: { limit: number; offset: number },
): Promise<SearchResult[]> {
  const { limit, offset } = options;

  // Get more results than needed for merging
  const fetchLimit = Math.max(limit * 2, 50);

  // Run both searches in parallel
  const [fulltextResults, embeddingResults] = await Promise.all([
    fulltextIndex.search(projectKey, indexName, text, {
      limit: fetchLimit,
      offset: 0,
      highlight: true,
    }),
    embeddingIndex.search(projectKey, indexName, text, {
      limit: fetchLimit,
      offset: 0,
    }).catch(() => [] as SearchResult[]), // Fallback if embedding fails
  ]);

  // Merge and deduplicate results using RRF (Reciprocal Rank Fusion)
  const scores = new Map<string, { score: number; result: SearchResult }>();
  const k = 60; // RRF constant

  // Process fulltext results
  for (let i = 0; i < fulltextResults.length; i++) {
    const r = fulltextResults[i];
    const rrfScore = 1 / (k + i + 1);
    const existing = scores.get(r.doc_id);
    if (existing) {
      existing.score += rrfScore;
    } else {
      scores.set(r.doc_id, { score: rrfScore, result: r });
    }
  }

  // Process embedding results
  for (let i = 0; i < embeddingResults.length; i++) {
    const r = embeddingResults[i];
    const rrfScore = 1 / (k + i + 1);
    const existing = scores.get(r.doc_id);
    if (existing) {
      existing.score += rrfScore;
      // Prefer fulltext snippet if available
    } else {
      scores.set(r.doc_id, { score: rrfScore, result: r });
    }
  }

  // Sort by combined score and apply pagination
  const sorted = [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(offset, offset + limit)
    .map(({ score, result }) => ({
      ...result,
      score,
    }));

  return sorted;
}
