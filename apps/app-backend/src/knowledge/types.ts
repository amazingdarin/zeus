/**
 * Multi-granularity Knowledge Index Types
 *
 * This module defines the types for a multi-level indexing system that supports:
 * - Document-level summaries
 * - Section-level indexes (by heading)
 * - Block-level indexes (paragraphs, lists, etc.)
 * - Code-specific indexes with symbol extraction
 */

/** Index granularity levels */
export type IndexGranularity = "document" | "section" | "block" | "code";

/** Query intent types for routing */
export type QueryType = "overview" | "howto" | "code" | "factual" | "general";

/** RAG retrieval strategies */
export type RAGStrategy = "basic" | "hyde" | "multi" | "raptor" | "adaptive";

/**
 * Unified index entry that supports all granularity levels
 */
export interface IndexEntry {
  /** Unique entry ID (format: {docId}:{granularity}:{identifier}) */
  id: string;

  /** Document ID this entry belongs to */
  doc_id: string;

  /** User ID for isolation */
  user_id: string;

  /** Project key */
  project_key: string;

  /** Granularity level */
  granularity: IndexGranularity;

  /** Text content */
  content: string;

  /**
   * Embedding vector (optional, computed lazily)
   * Dimension depends on embedding model:
   * - Ollama nomic-embed-text: 768
   * - OpenAI text-embedding-3-small: 1536
   */
  embedding?: number[];

  /** Structured metadata */
  metadata: IndexEntryMetadata;

  /** Timestamps */
  created_at: number;
  updated_at: number;
}

/**
 * Metadata for index entries
 */
export interface IndexEntryMetadata {
  /** Document or section title */
  title?: string;

  /** Block ID within the document */
  block_id?: string;

  /** Hierarchical path (ancestor titles) */
  path?: string[];

  /** Heading level for sections (1-6) */
  level?: number;

  /** Programming language for code blocks */
  language?: string;

  /** Extracted code symbols (function/class names) */
  symbols?: string[];

  /** RAPTOR tree level (0 = leaf, higher = summary) */
  raptor_level?: number;

  /** Child node IDs for RAPTOR tree */
  children?: string[];

  /** Parent document ID (for hierarchy-aware retrieval) */
  parent_doc_id?: string;

  /** Chunk index if content was split */
  chunk_index?: number;
}

/**
 * Result of chunking a document into multiple granularities
 */
export interface ChunkResult {
  /** Document-level summary entry */
  document: IndexEntry;

  /** Section-level entries (by heading) */
  sections: IndexEntry[];

  /** Block-level entries (paragraphs, lists, etc.) */
  blocks: IndexEntry[];

  /** Code block entries with symbol extraction */
  codes: IndexEntry[];
}

/**
 * RAPTOR tree node for hierarchical summarization
 */
export interface RaptorNode {
  id: string;
  user_id: string;
  owner_type: string;
  owner_id: string;
  project_key: string;
  doc_id: string;
  level: number;
  content: string;
  embedding?: number[];
  children: string[];
  created_at: number;
}

/**
 * Search options for the index
 */
export interface IndexSearchOptions {
  /** Granularity levels to search */
  granularities?: IndexGranularity[];

  /** Filter by document IDs */
  docIds?: string[];

  /** Maximum results */
  limit?: number;

  /** Offset for pagination */
  offset?: number;

  /** Pre-computed query vector */
  vector?: number[];

  /** Include hierarchy context */
  includeHierarchy?: boolean;

  /** Minimum similarity score */
  minScore?: number;
}

/**
 * Search result with enriched metadata
 */
export interface IndexSearchResult {
  /** Entry ID */
  id: string;

  /** Document ID */
  doc_id: string;

  /** Block ID (if applicable) */
  block_id?: string;

  /** Content snippet */
  content: string;

  /** Similarity/relevance score */
  score: number;

  /** Granularity level */
  granularity: IndexGranularity;

  /** Metadata */
  metadata: IndexEntryMetadata;

  /** Reranking score (if reranked) */
  rerank_score?: number;
}

/**
 * Hierarchy context for context-aware retrieval
 */
export interface HierarchyContext {
  /** Ancestor documents (parent, grandparent, etc.) */
  ancestors: Array<{
    id: string;
    title: string;
    summary?: string;
    depth: number;
  }>;

  /** Sibling document IDs */
  siblings?: string[];

  /** Direct child document IDs */
  children?: string[];
}

/**
 * RAG state for LangGraph
 */
export interface RAGState {
  /** User query */
  query: string;

  /** User ID */
  userId: string;

  /** Project key */
  projectKey: string;

  /** Optional document scope */
  docIds?: string[];

  /** Detected query type */
  queryType: QueryType;

  /** Selected retrieval strategy */
  strategy: RAGStrategy;

  /** Transformed query (e.g., HyDE) */
  transformedQuery?: string;

  /** Retrieved documents */
  retrievedDocs: IndexSearchResult[];

  /** Reranked documents */
  rerankedDocs: IndexSearchResult[];

  /** Hierarchy context */
  hierarchyContext?: HierarchyContext;

  /** Self-RAG sufficiency evaluation */
  sufficiency?: {
    sufficient: boolean;
    missing?: string;
  };

  /** Iteration count for Self-RAG loops */
  iteration?: number;
}

/**
 * Configuration for ancestor loading
 */
export interface AncestorLoadConfig {
  /** Depth level (0 = direct parent) */
  depth: number;

  /** Content loading strategy */
  loadContent: "full" | "summary" | "title";

  /** Maximum content length (for truncation) */
  maxLength?: number;
}

/**
 * Default ancestor loading configuration
 */
export const DEFAULT_ANCESTOR_CONFIG: AncestorLoadConfig[] = [
  { depth: 0, loadContent: "full", maxLength: 500 },
  { depth: 1, loadContent: "summary" },
  { depth: 2, loadContent: "summary" },
  // Higher levels: title only (no config needed)
];

/**
 * RAG evaluation metrics
 */
export interface RAGEvaluation {
  /** Retrieval precision: relevance of retrieved content */
  contextPrecision: number;

  /** Retrieval recall: coverage of needed information */
  contextRecall: number;

  /** Answer faithfulness: no hallucination */
  faithfulness: number;

  /** Answer relevancy: addresses the question */
  answerRelevancy: number;
}

/**
 * Langfuse trace configuration
 */
export interface TraceConfig {
  enabled: boolean;
  traceId?: string;
  sessionId?: string;
  userId?: string;
}
