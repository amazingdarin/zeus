/**
 * Chat Settings Store
 *
 * Manages global chat behaviour settings (singleton row in PostgreSQL).
 * Currently supports:
 *   - fullAccess: skip tool-call confirmation prompts
 */

import { query } from "../db/postgres.js";

// ============================================================================
// Types
// ============================================================================

type ChatSettingsRow = {
  id: string;
  full_access: boolean;
  created_at: Date;
  updated_at: Date;
};

export type ChatSettings = {
  fullAccess: boolean;
};

export type ChatSettingsInput = {
  fullAccess?: boolean;
};

// ============================================================================
// Cache
// ============================================================================

let dbAvailable = true;
let settingsCache: { settings: ChatSettings; timestamp: number } | null = null;
const CACHE_TTL = 60 * 1000; // 1 minute

export function clearChatSettingsCache(): void {
  settingsCache = null;
}

// ============================================================================
// Default
// ============================================================================

const DEFAULT_SETTINGS: ChatSettings = { fullAccess: false };

// ============================================================================
// Store
// ============================================================================

export const chatSettingsStore = {
  /**
   * Get chat settings (with 1-minute cache).
   * Gracefully returns defaults if the table does not exist.
   */
  async get(): Promise<ChatSettings> {
    if (settingsCache && Date.now() - settingsCache.timestamp < CACHE_TTL) {
      return settingsCache.settings;
    }

    try {
      const result = await query<ChatSettingsRow>(
        `SELECT * FROM chat_settings LIMIT 1`,
      );

      dbAvailable = true;

      if (result.rows.length === 0) {
        settingsCache = { settings: DEFAULT_SETTINGS, timestamp: Date.now() };
        return DEFAULT_SETTINGS;
      }

      const row = result.rows[0];
      const settings: ChatSettings = {
        fullAccess: row.full_access,
      };
      settingsCache = { settings, timestamp: Date.now() };
      return settings;
    } catch (err) {
      // DB connection refused
      if (err && typeof err === "object" && "code" in err && err.code === "ECONNREFUSED") {
        dbAvailable = false;
        return DEFAULT_SETTINGS;
      }
      // Table does not exist yet (relation "chat_settings" does not exist)
      if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "42P01") {
        console.warn("[chat-settings] Table does not exist yet, using defaults");
        return DEFAULT_SETTINGS;
      }
      throw err;
    }
  },

  /**
   * Update chat settings (upsert singleton row).
   */
  async update(input: ChatSettingsInput): Promise<ChatSettings> {
    if (!dbAvailable) {
      throw new Error("Database not available");
    }

    // Clear cache so next read sees the new value
    settingsCache = null;

    const fullAccess = input.fullAccess ?? false;
    const now = new Date();

    try {
      await query(
        `INSERT INTO chat_settings (id, full_access, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3)
         ON CONFLICT ((true))
         DO UPDATE SET full_access = $1, updated_at = $3`,
        [fullAccess, now, now],
      );

      dbAvailable = true;
      return this.get();
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && err.code === "ECONNREFUSED") {
        dbAvailable = false;
        throw new Error("Database not available");
      }
      throw err;
    }
  },
};
