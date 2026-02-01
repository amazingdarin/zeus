/**
 * Document metadata
 */
export interface DocumentMeta {
  id: string;
  schema_version: string;
  title: string;
  slug: string;
  path: string;
  parent_id: string;
  created_at: string;
  updated_at: string;
  extra?: Record<string, unknown>;
}

/**
 * Document body content
 */
export interface DocumentBody {
  type: "tiptap" | "markdown";
  content: unknown;
}

/**
 * Complete document structure
 */
export interface Document {
  meta: DocumentMeta;
  body: DocumentBody;
}

/**
 * Tree item for listing documents
 */
export interface TreeItem {
  id: string;
  slug: string;
  title: string;
  kind: "file" | "dir";
  children?: TreeItem[];
}

/**
 * Cached document info for in-memory index
 */
export interface CachedDoc {
  path: string;
  title: string;
  parentId: string;
}

/**
 * Request types for document operations
 */
export interface CreateDocumentRequest {
  meta: Partial<DocumentMeta> & { title: string };
  body: DocumentBody;
}

export interface MoveDocumentRequest {
  target_parent_id: string;
  before_doc_id?: string;
  after_doc_id?: string;
}

/**
 * Search related types
 */
export interface SearchQuery {
  mode?: "fulltext" | "embedding" | "hybrid";
  text: string;
  vector?: number[];
  filters?: Record<string, string>;
  limit?: number;
  offset?: number;
  sort_by?: string;
  highlight?: boolean;
  fuzzy?: boolean;
  min_similarity?: number;
}

export interface SearchResult {
  doc_id: string;
  block_id?: string;
  chunk_index?: number;
  score: number;
  snippet: string;
  metadata?: Record<string, string>;
}

/**
 * Embedding chunk for vector indexing
 */
export interface EmbeddingChunk {
  doc_id: string;
  block_id: string;
  chunk_index: number;
  content: string;
  model: string;
  vector: number[];
  metadata?: Record<string, unknown>;
}

/**
 * Block chunk for chunking process
 */
export interface BlockChunk {
  doc_id: string;
  block_id: string;
  chunk_index: number;
  content: string;
}
