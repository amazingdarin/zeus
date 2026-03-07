/**
 * Web Search Configuration Store
 *
 * Manages web search API configuration in PostgreSQL.
 */

import { v4 as uuidv4 } from "uuid";
import { query } from "../db/postgres.js";
import { encrypt, decrypt, maskApiKey, isMaskedKey } from "../utils/crypto.js";
import type { WebSearchProvider } from "./web-search.js";

// ============================================================================
// Types
// ============================================================================

export type WebSearchConfigRow = {
  id: string;
  provider: string;
  api_key_cipher: string | null;
  api_key_iv: string | null;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
};

export type WebSearchConfigResponse = {
  id: string;
  provider: WebSearchProvider;
  apiKeyMasked?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type WebSearchConfigInput = {
  provider: WebSearchProvider;
  apiKey?: string;
  enabled?: boolean;
};

// ============================================================================
// Configuration Store
// ============================================================================

let dbAvailable = true;
let configCache: { config: WebSearchConfigResponse | null; timestamp: number } | null = null;
const CONFIG_CACHE_TTL = 60 * 1000; // 1 minute

export const webSearchConfigStore = {
  /**
   * Get web search configuration
   */
  async get(): Promise<WebSearchConfigResponse | null> {
    if (configCache && Date.now() - configCache.timestamp < CONFIG_CACHE_TTL) {
      return configCache.config;
    }

    try {
      const result = await query<WebSearchConfigRow>(
        `SELECT * FROM web_search_config LIMIT 1`,
      );

      dbAvailable = true;

      if (result.rows.length === 0) {
        configCache = { config: null, timestamp: Date.now() };
        return null;
      }

      const row = result.rows[0];
      const config = mapRowToResponse(row);
      configCache = { config, timestamp: Date.now() };
      return config;
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && err.code === "ECONNREFUSED") {
        dbAvailable = false;
        return null;
      }
      // Table might not exist
      if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "42P01") {
        console.warn("[web-search-config] Table does not exist yet");
        return null;
      }
      throw err;
    }
  },

  /**
   * Create or update web search configuration (singleton)
   */
  async upsert(input: WebSearchConfigInput): Promise<WebSearchConfigResponse> {
    if (!dbAvailable) {
      throw new Error("Database not available");
    }

    // Clear cache
    configCache = null;

    const existing = await this.get();

    if (existing) {
      return this.update(existing.id, input);
    }

    const id = uuidv4();
    const now = new Date();

    // Encrypt API key if provided
    let apiKeyCipher: string | null = null;
    let apiKeyIv: string | null = null;
    if (input.apiKey) {
      const encrypted = encrypt(input.apiKey);
      apiKeyCipher = encrypted.cipher;
      apiKeyIv = encrypted.iv;
    }

    try {
      await query(
        `INSERT INTO web_search_config (id, provider, api_key_cipher, api_key_iv, enabled, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          id,
          input.provider,
          apiKeyCipher,
          apiKeyIv,
          input.enabled !== false,
          now,
          now,
        ],
      );

      dbAvailable = true;
      return (await this.get())!;
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && err.code === "ECONNREFUSED") {
        dbAvailable = false;
        throw new Error("Database not available");
      }
      throw err;
    }
  },

  /**
   * Update web search configuration
   */
  async update(id: string, input: Partial<WebSearchConfigInput>): Promise<WebSearchConfigResponse> {
    if (!dbAvailable) {
      throw new Error("Database not available");
    }

    // Clear cache
    configCache = null;

    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (input.provider !== undefined) {
      updates.push(`provider = $${paramIndex++}`);
      values.push(input.provider);
    }

    if (input.apiKey !== undefined && !isMaskedKey(input.apiKey)) {
      if (input.apiKey) {
        const encrypted = encrypt(input.apiKey);
        updates.push(`api_key_cipher = $${paramIndex++}`);
        values.push(encrypted.cipher);
        updates.push(`api_key_iv = $${paramIndex++}`);
        values.push(encrypted.iv);
      } else {
        updates.push(`api_key_cipher = $${paramIndex++}`);
        values.push(null);
        updates.push(`api_key_iv = $${paramIndex++}`);
        values.push(null);
      }
    }

    if (input.enabled !== undefined) {
      updates.push(`enabled = $${paramIndex++}`);
      values.push(input.enabled);
    }

    updates.push(`updated_at = $${paramIndex++}`);
    values.push(new Date());

    values.push(id);

    try {
      await query(
        `UPDATE web_search_config SET ${updates.join(", ")} WHERE id = $${paramIndex}`,
        values,
      );

      dbAvailable = true;
      return (await this.get())!;
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && err.code === "ECONNREFUSED") {
        dbAvailable = false;
        throw new Error("Database not available");
      }
      throw err;
    }
  },

  /**
   * Delete web search configuration
   */
  async delete(): Promise<boolean> {
    if (!dbAvailable) {
      throw new Error("Database not available");
    }

    // Clear cache
    configCache = null;

    try {
      const result = await query(`DELETE FROM web_search_config`);
      dbAvailable = true;
      return (result.rowCount ?? 0) > 0;
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && err.code === "ECONNREFUSED") {
        dbAvailable = false;
        throw new Error("Database not available");
      }
      throw err;
    }
  },

  /**
   * Clear configuration cache
   */
  clearCache(): void {
    configCache = null;
  },
};

// ============================================================================
// Helpers
// ============================================================================

function mapRowToResponse(row: WebSearchConfigRow): WebSearchConfigResponse {
  let apiKeyMasked: string | undefined;
  if (row.api_key_cipher && row.api_key_iv) {
    try {
      const apiKey = decrypt(row.api_key_cipher, row.api_key_iv);
      apiKeyMasked = maskApiKey(apiKey);
    } catch {
      apiKeyMasked = "[encrypted]";
    }
  }

  return {
    id: row.id,
    provider: row.provider as WebSearchProvider,
    apiKeyMasked,
    enabled: row.enabled,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
