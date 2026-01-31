/**
 * LLM Provider Configuration Store
 *
 * Manages persistence of provider configurations in PostgreSQL
 * with encrypted API key storage.
 */

import { v4 as uuidv4 } from "uuid";
import { query } from "../db/postgres.js";
import { encrypt, decrypt, maskApiKey, isMaskedKey } from "../utils/crypto.js";
import type { LLMProviderId } from "./types.js";

/**
 * Configuration type: LLM for chat/completion, embedding for embeddings
 */
export type ConfigType = "llm" | "embedding" | "vision";

/**
 * Provider configuration as stored in database
 */
export type ProviderConfigRow = {
  id: string;
  config_type: string;
  provider_id: string;
  display_name: string;
  base_url: string | null;
  default_model: string | null;
  api_key_cipher: string | null;
  api_key_iv: string | null;
  enabled: boolean;
  status: string;
  last_error: string | null;
  last_tested_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

/**
 * Provider configuration for API responses (API key masked)
 */
export type ProviderConfig = {
  id: string;
  configType: ConfigType;
  providerId: LLMProviderId;
  displayName: string;
  baseUrl?: string;
  defaultModel?: string;
  apiKeyMasked?: string;
  enabled: boolean;
  status: "active" | "error" | "unknown";
  lastError?: string;
  lastTestedAt?: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * Input for creating/updating a provider configuration
 */
export type ProviderConfigInput = {
  id?: string;
  configType?: ConfigType;
  providerId: LLMProviderId;
  displayName: string;
  baseUrl?: string;
  defaultModel?: string;
  apiKey?: string;
  enabled?: boolean;
};

/**
 * Internal config with decrypted API key (for runtime use)
 */
export type ProviderConfigInternal = ProviderConfig & {
  apiKey?: string;
};

/**
 * Map database row to API response format
 */
function mapRowToConfig(row: ProviderConfigRow): ProviderConfig {
  return {
    id: row.id,
    configType: row.config_type as ConfigType,
    providerId: row.provider_id as LLMProviderId,
    displayName: row.display_name,
    baseUrl: row.base_url || undefined,
    defaultModel: row.default_model || undefined,
    apiKeyMasked: row.api_key_cipher ? "****" : undefined,
    enabled: row.enabled,
    status: row.status as "active" | "error" | "unknown",
    lastError: row.last_error || undefined,
    lastTestedAt: row.last_tested_at?.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * Map database row to internal format with decrypted API key
 */
function mapRowToInternalConfig(row: ProviderConfigRow): ProviderConfigInternal {
  const config = mapRowToConfig(row) as ProviderConfigInternal;

  // Decrypt API key if present
  if (row.api_key_cipher && row.api_key_iv) {
    try {
      config.apiKey = decrypt(row.api_key_cipher, row.api_key_iv);
      config.apiKeyMasked = maskApiKey(config.apiKey);
    } catch (err) {
      console.error("Failed to decrypt API key:", err);
      config.apiKeyMasked = "[decryption failed]";
    }
  }

  return config;
}

/** Track if database is available */
let dbAvailable = true;

export const configStore = {
  /**
   * Check if database is available
   */
  isDbAvailable(): boolean {
    return dbAvailable;
  },

  /**
   * List all provider configurations
   */
  async list(): Promise<ProviderConfig[]> {
    try {
      const result = await query<ProviderConfigRow>(
        `SELECT * FROM llm_provider_config ORDER BY created_at ASC`,
      );

      dbAvailable = true;
      return result.rows.map((row) => {
        const config = mapRowToConfig(row);
        // Show masked key if API key exists
        if (row.api_key_cipher && row.api_key_iv) {
          try {
            const apiKey = decrypt(row.api_key_cipher, row.api_key_iv);
            config.apiKeyMasked = maskApiKey(apiKey);
          } catch {
            config.apiKeyMasked = "[encrypted]";
          }
        }
        return config;
      });
    } catch (err) {
      // Check if this is a connection error
      if (err && typeof err === "object" && "code" in err && err.code === "ECONNREFUSED") {
        dbAvailable = false;
        console.warn("Database not available, returning empty config list");
        return [];
      }
      throw err;
    }
  },

  /**
   * Get a single configuration by ID
   */
  async get(id: string): Promise<ProviderConfig | null> {
    try {
      const result = await query<ProviderConfigRow>(
        `SELECT * FROM llm_provider_config WHERE id = $1`,
        [id],
      );

      dbAvailable = true;
      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      const config = mapRowToConfig(row);
      if (row.api_key_cipher && row.api_key_iv) {
        try {
          const apiKey = decrypt(row.api_key_cipher, row.api_key_iv);
          config.apiKeyMasked = maskApiKey(apiKey);
        } catch {
          config.apiKeyMasked = "[encrypted]";
        }
      }
      return config;
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && err.code === "ECONNREFUSED") {
        dbAvailable = false;
        return null;
      }
      throw err;
    }
  },

  /**
   * Get a configuration with decrypted API key (for internal use)
   */
  async getInternal(id: string): Promise<ProviderConfigInternal | null> {
    try {
      const result = await query<ProviderConfigRow>(
        `SELECT * FROM llm_provider_config WHERE id = $1`,
        [id],
      );

      dbAvailable = true;
      if (result.rows.length === 0) {
        return null;
      }

      return mapRowToInternalConfig(result.rows[0]);
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && err.code === "ECONNREFUSED") {
        dbAvailable = false;
        return null;
      }
      throw err;
    }
  },

  /**
   * Get all enabled configurations with decrypted API keys (for provider registry)
   */
  async listEnabled(): Promise<ProviderConfigInternal[]> {
    try {
      const result = await query<ProviderConfigRow>(
        `SELECT * FROM llm_provider_config WHERE enabled = true ORDER BY created_at ASC`,
      );

      dbAvailable = true;
      return result.rows.map(mapRowToInternalConfig);
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && err.code === "ECONNREFUSED") {
        dbAvailable = false;
        return [];
      }
      throw err;
    }
  },

  /**
   * Get configuration by type (llm or embedding)
   */
  async getByType(configType: ConfigType): Promise<ProviderConfig | null> {
    try {
      const result = await query<ProviderConfigRow>(
        `SELECT * FROM llm_provider_config WHERE config_type = $1`,
        [configType],
      );

      dbAvailable = true;
      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      const config = mapRowToConfig(row);
      if (row.api_key_cipher && row.api_key_iv) {
        try {
          const apiKey = decrypt(row.api_key_cipher, row.api_key_iv);
          config.apiKeyMasked = maskApiKey(apiKey);
        } catch {
          config.apiKeyMasked = "[encrypted]";
        }
      }
      return config;
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && err.code === "ECONNREFUSED") {
        dbAvailable = false;
        return null;
      }
      throw err;
    }
  },

  /**
   * Get internal configuration by type (with decrypted API key)
   */
  async getInternalByType(configType: ConfigType): Promise<ProviderConfigInternal | null> {
    try {
      const result = await query<ProviderConfigRow>(
        `SELECT * FROM llm_provider_config WHERE config_type = $1`,
        [configType],
      );

      dbAvailable = true;
      if (result.rows.length === 0) {
        return null;
      }

      return mapRowToInternalConfig(result.rows[0]);
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && err.code === "ECONNREFUSED") {
        dbAvailable = false;
        return null;
      }
      throw err;
    }
  },

  /**
   * Create a new configuration
   */
  async create(input: ProviderConfigInput): Promise<ProviderConfig> {
    if (!dbAvailable) {
      throw new Error("Database not available. Please ensure PostgreSQL is running.");
    }

    const id = input.id || uuidv4();
    const configType = input.configType || "llm";
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
        `INSERT INTO llm_provider_config 
          (id, config_type, provider_id, display_name, base_url, default_model, api_key_cipher, api_key_iv, enabled, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          id,
          configType,
          input.providerId,
          input.displayName,
          input.baseUrl || null,
          input.defaultModel || null,
          apiKeyCipher,
          apiKeyIv,
          input.enabled !== false,
          "unknown",
          now,
          now,
        ],
      );

      dbAvailable = true;
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && err.code === "ECONNREFUSED") {
        dbAvailable = false;
        throw new Error("Database not available. Please ensure PostgreSQL is running.");
      }
      throw err;
    }

    const config = await this.get(id);
    if (!config) {
      throw new Error("Failed to create configuration");
    }
    return config;
  },

  /**
   * Upsert (create or update) configuration by type
   * Since only one config per type is allowed, this will replace existing config
   */
  async upsertByType(configType: ConfigType, input: Omit<ProviderConfigInput, "configType">): Promise<ProviderConfig> {
    // Check if config exists for this type
    const existing = await this.getByType(configType);
    
    if (existing) {
      // Update existing config
      return this.update(existing.id, input);
    } else {
      // Create new config
      return this.create({ ...input, configType });
    }
  },

  /**
   * Delete configuration by type
   */
  async deleteByType(configType: ConfigType): Promise<boolean> {
    if (!dbAvailable) {
      throw new Error("Database not available. Please ensure PostgreSQL is running.");
    }

    try {
      const result = await query(`DELETE FROM llm_provider_config WHERE config_type = $1`, [configType]);
      dbAvailable = true;
      return (result.rowCount ?? 0) > 0;
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && err.code === "ECONNREFUSED") {
        dbAvailable = false;
        throw new Error("Database not available. Please ensure PostgreSQL is running.");
      }
      throw err;
    }
  },

  /**
   * Update an existing configuration
   */
  async update(id: string, input: Partial<ProviderConfigInput>): Promise<ProviderConfig> {
    if (!dbAvailable) {
      throw new Error("Database not available. Please ensure PostgreSQL is running.");
    }

    // Get existing config to check if it exists
    const existing = await this.get(id);
    if (!existing) {
      throw new Error(`Configuration not found: ${id}`);
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (input.providerId !== undefined) {
      updates.push(`provider_id = $${paramIndex++}`);
      values.push(input.providerId);
    }

    if (input.displayName !== undefined) {
      updates.push(`display_name = $${paramIndex++}`);
      values.push(input.displayName);
    }

    if (input.baseUrl !== undefined) {
      updates.push(`base_url = $${paramIndex++}`);
      values.push(input.baseUrl || null);
    }

    if (input.defaultModel !== undefined) {
      updates.push(`default_model = $${paramIndex++}`);
      values.push(input.defaultModel || null);
    }

    if (input.apiKey !== undefined && !isMaskedKey(input.apiKey)) {
      // Only update API key if it's not a masked value
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

    // Always update updated_at
    updates.push(`updated_at = $${paramIndex++}`);
    values.push(new Date());

    // Add id as the last parameter
    values.push(id);

    try {
      await query(
        `UPDATE llm_provider_config SET ${updates.join(", ")} WHERE id = $${paramIndex}`,
        values,
      );
      dbAvailable = true;
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && err.code === "ECONNREFUSED") {
        dbAvailable = false;
        throw new Error("Database not available. Please ensure PostgreSQL is running.");
      }
      throw err;
    }

    const config = await this.get(id);
    if (!config) {
      throw new Error("Failed to update configuration");
    }
    return config;
  },

  /**
   * Delete a configuration
   */
  async delete(id: string): Promise<boolean> {
    if (!dbAvailable) {
      throw new Error("Database not available. Please ensure PostgreSQL is running.");
    }

    try {
      const result = await query(`DELETE FROM llm_provider_config WHERE id = $1`, [id]);
      dbAvailable = true;
      return (result.rowCount ?? 0) > 0;
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && err.code === "ECONNREFUSED") {
        dbAvailable = false;
        throw new Error("Database not available. Please ensure PostgreSQL is running.");
      }
      throw err;
    }
  },

  /**
   * Update status after a test
   */
  async updateStatus(
    id: string,
    status: "active" | "error" | "unknown",
    lastError?: string,
  ): Promise<void> {
    if (!dbAvailable) {
      console.warn("Database not available, skipping status update");
      return;
    }

    try {
      await query(
        `UPDATE llm_provider_config 
         SET status = $1, last_error = $2, last_tested_at = $3, updated_at = $4 
         WHERE id = $5`,
        [status, lastError || null, new Date(), new Date(), id],
      );
      dbAvailable = true;
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && err.code === "ECONNREFUSED") {
        dbAvailable = false;
        console.warn("Database not available, skipping status update");
        return;
      }
      throw err;
    }
  },
};
