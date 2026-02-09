import type { Document, SearchQuery, SearchResult } from "../storage/types.js";
import { documentStore } from "../storage/document-store.js";
import { indexStore, clearEmbeddingConfigCache } from "./index-store.js";
import type { IndexSearchResult } from "./types.js";
import { clearProjectSummaryCache, clearSummaryCache } from "./hierarchy.js";
import { buildRaptorTree, clearProjectRaptorTrees, clearRaptorTree } from "./raptor.js";

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
        return mapSearchResults(
          await indexStore.searchByFulltext(userId, projectKey, text, {
            docIds,
            limit,
            offset,
          }),
        );

      case "embedding":
        return mapSearchResults(
          await indexStore.searchByVector(userId, projectKey, text, {
            docIds,
            limit,
            offset,
            vector: query.vector,
          }),
        );

      case "hybrid":
      default:
        return hybridSearch(userId, projectKey, text, { limit, offset, docIds });
    }
  },

  /**
   * Index a document into the unified multi-granularity index.
   */
  async indexDocument(userId: string, projectKey: string, doc: Document): Promise<void> {
    const parentPath = await getParentPathTitles(userId, projectKey, doc.meta.id);
    const { indexed } = await indexStore.indexDocument(userId, projectKey, doc, parentPath);
    await clearSummaryCache(doc.meta.id);

    // Build RAPTOR tree from block/code-level chunks
    if (indexed > 0) {
      try {
        const entries = await indexStore.getByDocument(userId, projectKey, doc.meta.id, ["block", "code"]);
        if (entries.length > 0) {
          const chunks = entries.map((e) => ({ id: e.id, content: e.content }));
          await buildRaptorTree(userId, projectKey, doc.meta.id, chunks);
        }
      } catch (err) {
        console.warn("[Knowledge] RAPTOR tree build failed:", err);
      }
    }
  },

  /**
   * Remove a document from indexes
   */
  async removeDocument(userId: string, projectKey: string, docId: string): Promise<void> {
    await Promise.all([
      indexStore.removeDocument(userId, projectKey, docId),
      clearSummaryCache(docId),
      clearRaptorTree(userId, projectKey, docId),
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
    const progress: RebuildProgress = {
      total: documents.length,
      processed: 0,
      succeeded: 0,
      failed: 0,
      errors: [],
    };

    // Clear embedding config cache to get fresh settings
    clearEmbeddingConfigCache();

    // First, clear all existing index data for this project
    await Promise.all([
      indexStore.removeProject(userId, projectKey),
      clearProjectSummaryCache(userId, projectKey),
      clearProjectRaptorTrees(userId, projectKey),
    ]);

    // Precompute parent paths from the document list to avoid N calls to getHierarchy.
    const metaById = new Map(
      documents.map((d) => [d.meta.id, { title: d.meta.title, parentId: d.meta.parent_id }] as const),
    );

    // Index each document
    for (const doc of documents) {
      try {
        const parentPath = computeParentPathFromList(metaById, doc.meta.id);
        const { indexed } = await indexStore.indexDocument(userId, projectKey, doc, parentPath);
        await clearSummaryCache(doc.meta.id);

        // Build RAPTOR tree from block/code-level chunks
        if (indexed > 0) {
          try {
            const entries = await indexStore.getByDocument(userId, projectKey, doc.meta.id, ["block", "code"]);
            if (entries.length > 0) {
              const chunks = entries.map((e) => ({ id: e.id, content: e.content }));
              await buildRaptorTree(userId, projectKey, doc.meta.id, chunks);
            }
          } catch (err) {
            console.warn("[Knowledge] RAPTOR tree build failed for doc", doc.meta.id, err);
          }
        }

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

// Maximum entries per document in search results (avoid one document dominating).
const MAX_ENTRIES_PER_DOC = 3;

/**
 * Hybrid search combining fulltext and embedding results
 */
async function hybridSearch(
  userId: string,
  projectKey: string,
  text: string,
  options: { limit: number; offset: number; docIds?: string[] },
): Promise<SearchResult[]> {
  const { limit, offset, docIds } = options;

  // Fetch more than needed to allow fusion + per-doc limiting + pagination.
  const fetchLimit = Math.max(limit * 8, 80);

  const [fulltextResults, vectorResults] = await Promise.all([
    indexStore.searchByFulltext(userId, projectKey, text, {
      docIds,
      limit: fetchLimit,
      offset: 0,
    }).catch(() => [] as IndexSearchResult[]),
    indexStore.searchByVector(userId, projectKey, text, {
      docIds,
      limit: fetchLimit,
      offset: 0,
    }).catch(() => [] as IndexSearchResult[]),
  ]);

  // Fuse results using RRF. Prefer a wide top-N then apply per-doc limiting + pagination.
  const fused = indexStore.reciprocalRankFusion([vectorResults, fulltextResults], fetchLimit);
  const fusedLimited = limitResultsPerDoc(fused, MAX_ENTRIES_PER_DOC).slice(offset, offset + limit);
  return mapSearchResults(fusedLimited);
}

async function getParentPathTitles(
  userId: string,
  projectKey: string,
  docId: string,
): Promise<string[]> {
  try {
    const chain = await documentStore.getHierarchy(userId, projectKey, docId);
    // Chain is [root, ..., parent, current]; we store only ancestor titles.
    return chain.slice(0, -1).map((h) => h.title).filter(Boolean);
  } catch {
    return [];
  }
}

function computeParentPathFromList(
  metaById: Map<string, { title: string; parentId: string }>,
  docId: string,
): string[] {
  const visited = new Set<string>();
  const path: string[] = [];
  let currentId = docId;

  while (currentId) {
    if (visited.has(currentId)) break;
    visited.add(currentId);

    const meta = metaById.get(currentId);
    if (!meta) break;

    const parentId = meta.parentId?.trim();
    if (!parentId || parentId === "root") break;

    const parentMeta = metaById.get(parentId);
    if (!parentMeta) break;

    path.push(parentMeta.title);
    currentId = parentId;
  }

  return path.reverse().filter(Boolean);
}

function mapSearchResults(results: IndexSearchResult[]): SearchResult[] {
  return results.map((r) => ({
    doc_id: r.doc_id,
    block_id: r.block_id || (r.metadata?.block_id as string | undefined),
    chunk_index: typeof (r.metadata as Record<string, unknown> | undefined)?.chunk_index === "number"
      ? ((r.metadata as Record<string, unknown>).chunk_index as number)
      : undefined,
    score: r.score,
    snippet: r.content,
    metadata: stringifyMetadata({
      ...((r.metadata as Record<string, unknown>) || {}),
      granularity: r.granularity,
    }),
  }));
}

function stringifyMetadata(
  input: Record<string, unknown> | null | undefined,
): Record<string, string> | undefined {
  if (!input) return undefined;

  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!key || value === null || value === undefined) continue;

    if (Array.isArray(value)) {
      output[key] = value.map((v) => (typeof v === "string" ? v : String(v))).join(", ");
      continue;
    }

    output[key] = typeof value === "string" ? value : String(value);
  }
  return output;
}

function limitResultsPerDoc(results: IndexSearchResult[], maxPerDoc: number): IndexSearchResult[] {
  const counts = new Map<string, number>();
  const filtered: IndexSearchResult[] = [];

  for (const r of results) {
    const count = counts.get(r.doc_id) || 0;
    if (count >= maxPerDoc) continue;
    counts.set(r.doc_id, count + 1);
    filtered.push(r);
  }

  return filtered;
}
