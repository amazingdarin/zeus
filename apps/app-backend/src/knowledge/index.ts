/**
 * Knowledge Module
 *
 * This module provides a comprehensive RAG system with:
 * - Multi-granularity indexing (document, section, block, code)
 * - Multiple retrieval strategies (basic, HyDE, multi-route, RAPTOR)
 * - Hierarchy-aware context loading
 * - Document tree synchronization
 * - Evaluation and observability
 *
 * @example
 * ```typescript
 * import { ragSearch, indexStore } from './knowledge';
 *
 * // Index a document
 * await indexStore.indexDocument(userId, projectKey, doc);
 *
 * // Search with adaptive strategy
 * const results = await ragSearch(userId, projectKey, "How to use authentication?");
 * ```
 */

// Types
export type {
  IndexGranularity,
  QueryType,
  RAGStrategy,
  IndexEntry,
  IndexEntryMetadata,
  ChunkResult,
  RaptorNode,
  IndexSearchOptions,
  IndexSearchResult,
  HierarchyContext,
  RAGState,
  AncestorLoadConfig,
  RAGEvaluation,
  TraceConfig,
} from "./types.js";

export { DEFAULT_ANCESTOR_CONFIG } from "./types.js";

// Chunking
export { chunkDocument, flattenChunkResult, getChunkStats, extractCodeSymbols } from "./chunker-v2.js";

// Index Store
export { indexStore, clearEmbeddingConfigCache } from "./index-store.js";

// RAG Graph (State Machine)
export { executeRAGGraph, ragSearch, ragSearchWithState } from "./rag-graph.js";

// Hierarchy
export {
  loadHierarchyContext,
  loadHierarchyForSearchResults,
  getDocumentSummary,
  clearSummaryCache,
  clearProjectSummaryCache,
  buildHierarchyContextString,
  enrichResultsWithHierarchy,
} from "./hierarchy.js";

// Tree Sync
export {
  treeSyncManager,
  notifyDocumentMoved,
  notifyDocumentDeleted,
  notifyDocumentUpdated,
  forceSyncProject,
} from "./tree-sync.js";

// RAPTOR
export {
  buildRaptorTree,
  searchRaptorTree,
  clearRaptorTree,
  clearProjectRaptorTrees,
  getRaptorStats,
} from "./raptor.js";

// Evaluation
export {
  evaluateRAGResponse,
  evaluateSufficiency,
  runEvaluationSuite,
  evaluateRetrieval,
  generateEvaluationSummary,
  type RAGEvaluationInput,
  type TestCase,
  type EvaluationResult,
  type EvaluationSuiteResult,
} from "./evaluation.js";

// Legacy exports for backward compatibility
export { buildChunks, extractDocumentText } from "./chunker.js";
export { fulltextIndex } from "./fulltext-index.js";
export { embeddingIndex, clearEmbeddingConfigCache as clearOldEmbeddingConfigCache } from "./embedding-index.js";
export { knowledgeSearch } from "./search.js";
