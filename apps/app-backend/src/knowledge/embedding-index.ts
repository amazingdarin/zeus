import { query } from "../db/postgres.js";
import type { Document, SearchResult } from "../storage/types.js";
import { buildChunks } from "./chunker.js";
import { llmGateway, type LLMProviderId } from "../llm/index.js";

// Legacy Ollama API configuration (fallback)
const EMBEDDING_API_URL = process.env.EMBEDDING_API_URL || "";
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-small";

// LLM Gateway configuration
const EMBEDDING_PROVIDER = (process.env.EMBEDDING_PROVIDER || "openai") as LLMProviderId;
const EMBEDDING_USE_GATEWAY = process.env.EMBEDDING_USE_GATEWAY !== "false";

/**
 * Call the embedding API to generate vectors
 * Uses LLM Gateway by default, falls back to legacy Ollama API if configured
 */
async function embed(inputs: string[]): Promise<number[][]> {
  if (inputs.length === 0) return [];

  // Use LLM Gateway if enabled and provider is available
  if (EMBEDDING_USE_GATEWAY && llmGateway.isProviderAvailable(EMBEDDING_PROVIDER)) {
    try {
      const result = await llmGateway.generateEmbeddings({
        provider: EMBEDDING_PROVIDER,
        model: EMBEDDING_MODEL,
        inputs,
      });
      return result.embeddings;
    } catch (err) {
      console.warn("LLM Gateway embedding failed, falling back to legacy API:", err);
      // Fall through to legacy API
    }
  }

  // Legacy Ollama API fallback
  if (!EMBEDDING_API_URL) {
    throw new Error("No embedding provider available. Set OPENAI_API_KEY or EMBEDDING_API_URL.");
  }

  const vectors: number[][] = [];

  for (const input of inputs) {
    const response = await fetch(EMBEDDING_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        prompt: input,
      }),
    });

    if (!response.ok) {
      throw new Error(`Embedding API error: ${response.status}`);
    }

    const data = (await response.json()) as { embedding: number[] };
    vectors.push(data.embedding);
  }

  return vectors;
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
          EMBEDDING_MODEL,
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
      score: number;
      content: string;
      metadata_json: Record<string, unknown>;
    }>(
      `SELECT 
         doc_id,
         1 - (embedding <-> $3::vector) as score,
         content,
         metadata_json
       FROM knowledge_embedding_index
       WHERE project_key = $1 AND index_name = $2
       ORDER BY embedding <-> $3::vector
       LIMIT $4 OFFSET $5`,
      [projectKey, indexName, formatVector(vector), limit, offset],
    );

    return result.rows.map((row) => ({
      doc_id: row.doc_id,
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
