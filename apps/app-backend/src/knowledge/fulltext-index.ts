import { query } from "../db/postgres.js";
import { resolveProjectScope } from "../project-scope.js";
import type { Document, SearchResult } from "../storage/types.js";
import { extractDocumentText } from "./chunker.js";

type FulltextLanguage = "english" | "zhparser";

/**
 * Detect the primary language of text
 */
function detectLanguage(text: string): FulltextLanguage {
  for (const char of text) {
    if (char.charCodeAt(0) > 127) {
      return "zhparser";
    }
  }
  return "english";
}

export const fulltextIndex = {
  /**
   * Upsert a document into the fulltext index
   */
  async upsert(projectKey: string, indexName: string, doc: Document): Promise<void> {
    if (!projectKey.trim() || !indexName.trim() || !doc?.meta?.id) {
      throw new Error("Invalid parameters for fulltext upsert");
    }

    const scope = resolveProjectScope("", projectKey);
    const contentPlain = extractDocumentText(doc);
    const title = doc.meta.title || "";
    const metadata = {
      title,
      path: doc.meta.path || "",
    };

    await query(
      `INSERT INTO knowledge_fulltext_index
        (owner_type, owner_id, project_key, index_name, doc_id, title, content_plain, tsv_en, tsv_zh, metadata_json, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, to_tsvector('english', $7), to_tsvector('zhparser', $7), $8, NOW())
       ON CONFLICT (owner_type, owner_id, project_key, index_name, doc_id)
       DO UPDATE SET
         title = EXCLUDED.title,
         content_plain = EXCLUDED.content_plain,
         tsv_en = EXCLUDED.tsv_en,
         tsv_zh = EXCLUDED.tsv_zh,
         metadata_json = EXCLUDED.metadata_json,
         updated_at = NOW()`,
      [scope.ownerType, scope.ownerId, scope.projectKey, indexName, doc.meta.id, title, contentPlain, JSON.stringify(metadata)],
    );
  },

  /**
   * Remove a document from the fulltext index
   */
  async remove(projectKey: string, indexName: string, docId: string): Promise<void> {
    const scope = resolveProjectScope("", projectKey);

    await query(
      `DELETE FROM knowledge_fulltext_index
       WHERE owner_type = $1 AND owner_id = $2 AND project_key = $3 AND index_name = $4 AND doc_id = $5`,
      [scope.ownerType, scope.ownerId, scope.projectKey, indexName, docId],
    );
  },

  /**
   * Remove all documents for an index
   */
  async removeByIndex(projectKey: string, indexName: string): Promise<void> {
    const scope = resolveProjectScope("", projectKey);

    await query(
      `DELETE FROM knowledge_fulltext_index
       WHERE owner_type = $1 AND owner_id = $2 AND project_key = $3 AND index_name = $4`,
      [scope.ownerType, scope.ownerId, scope.projectKey, indexName],
    );
  },

  /**
   * Search the fulltext index
   */
  async search(
    projectKey: string,
    indexName: string,
    queryText: string,
    options: {
      limit?: number;
      offset?: number;
      highlight?: boolean;
      sortBy?: string;
      filters?: Record<string, string>;
      docIds?: string[];
    } = {},
  ): Promise<SearchResult[]> {
    const { limit = 20, offset = 0, highlight = false, docIds } = options;

    if (!queryText.trim()) {
      return [];
    }

    const scope = resolveProjectScope("", projectKey);
    const lang = detectLanguage(queryText);
    const tsvColumn = lang === "zhparser" ? "tsv_zh" : "tsv_en";
    const config = lang === "zhparser" ? "zhparser" : "english";

    let snippetExpr: string;
    if (highlight) {
      snippetExpr = `ts_headline('${config}', content_plain, plainto_tsquery('${config}', $5), 'MaxWords=50, MinWords=20')`;
    } else {
      snippetExpr = "LEFT(content_plain, 200)";
    }

    let sql: string;
    let params: unknown[];

    if (docIds && docIds.length > 0) {
      sql = `SELECT
         doc_id,
         ts_rank(${tsvColumn}, plainto_tsquery('${config}', $5)) as score,
         ${snippetExpr} as snippet,
         metadata_json
       FROM knowledge_fulltext_index
       WHERE owner_type = $1
         AND owner_id = $2
         AND project_key = $3
         AND index_name = $4
         AND ${tsvColumn} @@ plainto_tsquery('${config}', $5)
         AND doc_id = ANY($8)
       ORDER BY score DESC
       LIMIT $6 OFFSET $7`;
      params = [scope.ownerType, scope.ownerId, scope.projectKey, indexName, queryText, limit, offset, docIds];
    } else {
      sql = `SELECT
         doc_id,
         ts_rank(${tsvColumn}, plainto_tsquery('${config}', $5)) as score,
         ${snippetExpr} as snippet,
         metadata_json
       FROM knowledge_fulltext_index
       WHERE owner_type = $1
         AND owner_id = $2
         AND project_key = $3
         AND index_name = $4
         AND ${tsvColumn} @@ plainto_tsquery('${config}', $5)
       ORDER BY score DESC
       LIMIT $6 OFFSET $7`;
      params = [scope.ownerType, scope.ownerId, scope.projectKey, indexName, queryText, limit, offset];
    }

    const result = await query<{
      doc_id: string;
      score: number;
      snippet: string;
      metadata_json: Record<string, unknown>;
    }>(sql, params);

    return result.rows.map((row) => ({
      doc_id: row.doc_id,
      score: row.score,
      snippet: row.snippet,
      metadata: stringifyMetadata(row.metadata_json),
    }));
  },

  /**
   * Fuzzy search using trigram similarity
   */
  async fuzzySearch(
    projectKey: string,
    indexName: string,
    queryText: string,
    options: {
      minSimilarity?: number;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<SearchResult[]> {
    const { minSimilarity = 0.3, limit = 20, offset = 0 } = options;

    if (!queryText.trim()) {
      return [];
    }

    const scope = resolveProjectScope("", projectKey);

    const result = await query<{
      doc_id: string;
      score: number;
      snippet: string;
      metadata_json: Record<string, unknown>;
    }>(
      `SELECT
         doc_id,
         similarity(title || ' ' || content_plain, $5) as score,
         LEFT(content_plain, 200) as snippet,
         metadata_json
       FROM knowledge_fulltext_index
       WHERE owner_type = $1
         AND owner_id = $2
         AND project_key = $3
         AND index_name = $4
         AND similarity(title || ' ' || content_plain, $5) > $6
       ORDER BY score DESC
       LIMIT $7 OFFSET $8`,
      [scope.ownerType, scope.ownerId, scope.projectKey, indexName, queryText, minSimilarity, limit, offset],
    );

    return result.rows.map((row) => ({
      doc_id: row.doc_id,
      score: row.score,
      snippet: row.snippet,
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
