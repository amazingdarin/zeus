import { query } from "../db/postgres.js";
import type { Document, SearchResult } from "../storage/types.js";
import { buildChunks } from "./chunker.js";
import { llmGateway, configStore, type LLMProviderId, type ProviderConfigInternal } from "../llm/index.js";

// Cache for embedding config to avoid repeated DB queries
let cachedEmbeddingConfig: ProviderConfigInternal | null | undefined = undefined;
let configLastChecked = 0;
const CONFIG_CACHE_TTL = 60000; // 1 minute

/**
 * Get the configured embedding provider
 */
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
    console.warn("Failed to get embedding config:", err);
    return null;
  }
}

/**
 * Clear the embedding config cache (call after config changes)
 */
export function clearEmbeddingConfigCache(): void {
  cachedEmbeddingConfig = undefined;
  configLastChecked = 0;
}

/**
 * Call the embedding API to generate vectors
 * Uses the configured embedding provider from AI settings
 */
async function embed(inputs: string[]): Promise<number[][]> {
  if (inputs.length === 0) return [];

  // Get the configured embedding provider
  const config = await getEmbeddingConfig();

  if (!config || !config.enabled) {
    throw new Error("No embedding provider configured. Please configure an Embedding provider in AI settings.");
  }

  const provider = config.providerId as LLMProviderId;
  const model = config.defaultModel || "text-embedding-3-small";

  // Use LLM Gateway with the configured provider
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

/**
 * Get the current embedding model name
 */
async function getEmbeddingModel(): Promise<string> {
  const config = await getEmbeddingConfig();
  return config?.defaultModel || "unknown";
}

/**
 * Format a vector for PostgreSQL pgvector
 */
function formatVector(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

export const embeddingIndex = {
  /**
   * Upsert a document into the embedding index
   */
  async upsert(projectKey: string, indexName: string, doc: Document): Promise<void> {
    if (!projectKey.trim() || !indexName.trim() || !doc?.meta?.id) {
      throw new Error("Invalid parameters for embedding upsert");
    }

    const chunks = buildChunks(doc);
    if (chunks.length === 0) return;

    // Generate embeddings
    const inputs = chunks.map((c) => c.content);
    const vectors = await embed(inputs);

    if (vectors.length !== chunks.length) {
      throw new Error("Embedding size mismatch");
    }

    // Get the model name for metadata
    const modelName = await getEmbeddingModel();

    // Delete existing chunks for this document
    await query(
      `DELETE FROM knowledge_embedding_index 
       WHERE project_key = $1 AND index_name = $2 AND doc_id = $3`,
      [projectKey, indexName, doc.meta.id],
    );

    // Insert new chunks
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const vector = vectors[i];
      const metadata = {
        doc_id: chunk.doc_id,
        block_id: chunk.block_id,
        chunk: chunk.chunk_index,
        title: doc.meta.title,
        path: doc.meta.path,
      };

      await query(
        `INSERT INTO knowledge_embedding_index 
          (project_key, index_name, doc_id, block_id, chunk_index, content, model, embedding, metadata_json, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector, $9, NOW())`,
        [
          projectKey,
          indexName,
          chunk.doc_id,
          chunk.block_id,
          chunk.chunk_index,
          chunk.content,
          modelName,
          formatVector(vector),
          JSON.stringify(metadata),
        ],
      );
    }
  },

  /**
   * Remove a document from the embedding index
   */
  async remove(projectKey: string, indexName: string, docId: string): Promise<void> {
    await query(
      `DELETE FROM knowledge_embedding_index 
       WHERE project_key = $1 AND index_name = $2 AND doc_id = $3`,
      [projectKey, indexName, docId],
    );
  },

  /**
   * Remove all documents for an index
   */
  async removeByIndex(projectKey: string, indexName: string): Promise<void> {
    await query(
      `DELETE FROM knowledge_embedding_index 
       WHERE project_key = $1 AND index_name = $2`,
      [projectKey, indexName],
    );
  },

  /**
   * Search the embedding index using vector similarity
   */
  async search(
    projectKey: string,
    indexName: string,
    queryText: string,
    options: {
      limit?: number;
      offset?: number;
      vector?: number[];
    } = {},
  ): Promise<SearchResult[]> {
    const { limit = 20, offset = 0 } = options;
    let { vector } = options;

    if (!vector || vector.length === 0) {
      if (!queryText.trim()) {
        return [];
      }
      const vectors = await embed([queryText]);
      if (vectors.length === 0) {
        return [];
      }
      vector = vectors[0];
    }

    const result = await query<{
      doc_id: string;
      block_id: string;
      chunk_index: number;
      score: number;
      content: string;
      metadata_json: Record<string, unknown>;
    }>(
      `SELECT 
         doc_id,
         block_id,
         chunk_index,
         1 - (embedding <=> $3::vector) as score,
         content,
         metadata_json
       FROM knowledge_embedding_index
       WHERE project_key = $1 AND index_name = $2
       ORDER BY embedding <=> $3::vector
       LIMIT $4 OFFSET $5`,
      [projectKey, indexName, formatVector(vector), limit, offset],
    );

    return result.rows.map((row) => ({
      doc_id: row.doc_id,
      block_id: row.block_id || undefined,
      chunk_index: row.chunk_index,
      score: row.score,
      snippet: row.content,
      metadata: stringifyMetadata(row.metadata_json),
    }));
  },
};

/**
 * Convert metadata to string map
 */
function stringifyMetadata(
  input: Record<string, unknown> | null | undefined,
): Record<string, string> | undefined {
  if (!input) return undefined;

  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!key || value === null || value === undefined) continue;
    output[key] = typeof value === "string" ? value : String(value);
  }

  return Object.keys(output).length > 0 ? output : undefined;
}
