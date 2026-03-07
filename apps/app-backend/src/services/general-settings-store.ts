/**
 * General Settings Store
 *
 * Per-user general settings used by frontend clients.
 * Currently supports:
 *   - useRemoteKnowledgeBase: whether knowledge-base related APIs should use remote backend
 *   - documentAutoSync: whether document git auto-sync to remote is enabled
 *   - trashAutoCleanupEnabled: whether trash auto cleanup is enabled
 *   - trashAutoCleanupDays: retention days for trash auto cleanup
 *   - documentBlockShortcuts: configurable slash shortcuts for builtin doc blocks
 */

import { query } from "../db/postgres.js";
import {
  DEFAULT_DOCUMENT_BLOCK_SHORTCUTS,
  sanitizeDocumentBlockShortcuts,
  type DocumentBlockShortcuts,
} from "./general-settings-shortcuts.js";

type QueryLike = <T extends Record<string, unknown>>(
  sql: string,
  params?: unknown[],
) => Promise<{ rows: T[] }>;

type GeneralSettingsRow = {
  user_id: string;
  use_remote_knowledge_base: boolean;
  document_auto_sync: boolean;
  trash_auto_cleanup_enabled: boolean;
  trash_auto_cleanup_days: number;
  document_block_shortcuts: unknown;
  created_at: Date;
  updated_at: Date;
};

export type GeneralSettings = {
  useRemoteKnowledgeBase: boolean;
  documentAutoSync: boolean;
  trashAutoCleanupEnabled: boolean;
  trashAutoCleanupDays: number;
  documentBlockShortcuts: DocumentBlockShortcuts;
};

export type GeneralSettingsInput = {
  useRemoteKnowledgeBase?: boolean;
  documentAutoSync?: boolean;
  trashAutoCleanupEnabled?: boolean;
  trashAutoCleanupDays?: number;
  documentBlockShortcuts?: DocumentBlockShortcuts;
};

export type GeneralSettingsStore = {
  get(userId: string): Promise<GeneralSettings>;
  update(userId: string, input: GeneralSettingsInput): Promise<GeneralSettings>;
  clearCache(userId?: string): void;
};

const DEFAULT_SETTINGS: GeneralSettings = {
  useRemoteKnowledgeBase: false,
  documentAutoSync: false,
  trashAutoCleanupEnabled: false,
  trashAutoCleanupDays: 30,
  documentBlockShortcuts: { ...DEFAULT_DOCUMENT_BLOCK_SHORTCUTS },
};

function normalizeUserId(userId: string): string {
  return String(userId ?? "").trim();
}

function isPgRelationNotFoundError(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "code" in err && (err as { code: string }).code === "42P01");
}

function isDbConnectionRefused(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "code" in err && (err as { code: string }).code === "ECONNREFUSED");
}

function cloneGeneralSettings(settings: GeneralSettings): GeneralSettings {
  return {
    useRemoteKnowledgeBase: settings.useRemoteKnowledgeBase,
    documentAutoSync: settings.documentAutoSync,
    trashAutoCleanupEnabled: settings.trashAutoCleanupEnabled,
    trashAutoCleanupDays: settings.trashAutoCleanupDays,
    documentBlockShortcuts: { ...settings.documentBlockShortcuts },
  };
}

function normalizeTrashAutoCleanupDays(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const rounded = Math.floor(parsed);
  if (rounded < 1) {
    return 1;
  }
  if (rounded > 3650) {
    return 3650;
  }
  return rounded;
}

export function createGeneralSettingsStore(
  deps?: { queryFn?: QueryLike },
): GeneralSettingsStore {
  const queryFn: QueryLike = deps?.queryFn ?? (query as unknown as QueryLike);
  const settingsCache = new Map<string, { settings: GeneralSettings; timestamp: number }>();
  const CACHE_TTL = 60 * 1000;
  let dbAvailable = true;
  let ensureTablePromise: Promise<void> | null = null;

  const clearCache = (userId?: string): void => {
    const normalized = normalizeUserId(String(userId ?? ""));
    if (!normalized) {
      settingsCache.clear();
      return;
    }
    settingsCache.delete(normalized);
  };

  const ensureGeneralSettingsTable = async (): Promise<void> => {
    if (ensureTablePromise) {
      await ensureTablePromise;
      return;
    }

    ensureTablePromise = (async () => {
      await queryFn(
        `CREATE TABLE IF NOT EXISTS user_general_settings
         (
           user_id                   TEXT PRIMARY KEY,
           use_remote_knowledge_base BOOLEAN NOT NULL DEFAULT false,
           document_auto_sync        BOOLEAN NOT NULL DEFAULT false,
           trash_auto_cleanup_enabled BOOLEAN NOT NULL DEFAULT false,
           trash_auto_cleanup_days    INTEGER NOT NULL DEFAULT 30 CHECK (trash_auto_cleanup_days >= 1 AND trash_auto_cleanup_days <= 3650),
           document_block_shortcuts  JSONB NOT NULL DEFAULT '{}'::jsonb,
           created_at                TIMESTAMPTZ DEFAULT now(),
           updated_at                TIMESTAMPTZ DEFAULT now()
         )`,
      );
      await queryFn(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_user_general_settings_user_id
         ON user_general_settings (user_id)`,
      );
      await queryFn(
        `ALTER TABLE user_general_settings
         ADD COLUMN IF NOT EXISTS document_block_shortcuts JSONB NOT NULL DEFAULT '{}'::jsonb`,
      );
      await queryFn(
        `ALTER TABLE user_general_settings
         ADD COLUMN IF NOT EXISTS trash_auto_cleanup_enabled BOOLEAN NOT NULL DEFAULT false`,
      );
      await queryFn(
        `ALTER TABLE user_general_settings
         ADD COLUMN IF NOT EXISTS trash_auto_cleanup_days INTEGER NOT NULL DEFAULT 30`,
      );
    })();

    try {
      await ensureTablePromise;
    } finally {
      ensureTablePromise = null;
    }
  };

  return {
    async get(userId: string): Promise<GeneralSettings> {
      const normalizedUserId = normalizeUserId(userId);
      if (!normalizedUserId) {
        return cloneGeneralSettings(DEFAULT_SETTINGS);
      }

      const cached = settingsCache.get(normalizedUserId);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.settings;
      }

      try {
        const result = await queryFn<GeneralSettingsRow>(
          `SELECT * FROM user_general_settings WHERE user_id = $1 LIMIT 1`,
          [normalizedUserId],
        );

        dbAvailable = true;

        if (result.rows.length === 0) {
          settingsCache.set(normalizedUserId, {
            settings: cloneGeneralSettings(DEFAULT_SETTINGS),
            timestamp: Date.now(),
          });
          return cloneGeneralSettings(DEFAULT_SETTINGS);
        }

        const row = result.rows[0];
        const settings: GeneralSettings = {
          useRemoteKnowledgeBase: Boolean(row.use_remote_knowledge_base),
          documentAutoSync: Boolean(row.document_auto_sync),
          trashAutoCleanupEnabled: Boolean(row.trash_auto_cleanup_enabled),
          trashAutoCleanupDays: normalizeTrashAutoCleanupDays(
            row.trash_auto_cleanup_days,
            DEFAULT_SETTINGS.trashAutoCleanupDays
          ),
          documentBlockShortcuts: sanitizeDocumentBlockShortcuts(
            row.document_block_shortcuts
          ),
        };
        settingsCache.set(normalizedUserId, {
          settings,
          timestamp: Date.now(),
        });
        return settings;
      } catch (err) {
        if (isDbConnectionRefused(err)) {
          dbAvailable = false;
          return cloneGeneralSettings(DEFAULT_SETTINGS);
        }
        if (isPgRelationNotFoundError(err)) {
          console.warn("[general-settings] Table does not exist yet, using defaults");
          return cloneGeneralSettings(DEFAULT_SETTINGS);
        }
        throw err;
      }
    },

    async update(userId: string, input: GeneralSettingsInput): Promise<GeneralSettings> {
      if (!dbAvailable) {
        throw new Error("Database not available");
      }

      const normalizedUserId = normalizeUserId(userId);
      if (!normalizedUserId) {
        throw new Error("userId is required");
      }

      clearCache(normalizedUserId);

      const current = await this.get(normalizedUserId);
      const next: GeneralSettings = {
        useRemoteKnowledgeBase: input.useRemoteKnowledgeBase ?? current.useRemoteKnowledgeBase,
        documentAutoSync: input.documentAutoSync ?? current.documentAutoSync,
        trashAutoCleanupEnabled: input.trashAutoCleanupEnabled ?? current.trashAutoCleanupEnabled,
        trashAutoCleanupDays: normalizeTrashAutoCleanupDays(
          input.trashAutoCleanupDays,
          current.trashAutoCleanupDays
        ),
        documentBlockShortcuts: input.documentBlockShortcuts ?? current.documentBlockShortcuts,
      };
      const now = new Date();

      try {
        await ensureGeneralSettingsTable();
        await queryFn(
          `INSERT INTO user_general_settings
              (user_id, use_remote_knowledge_base, document_auto_sync, trash_auto_cleanup_enabled, trash_auto_cleanup_days, document_block_shortcuts, created_at, updated_at)
           VALUES
              ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (user_id)
           DO UPDATE SET
              use_remote_knowledge_base = EXCLUDED.use_remote_knowledge_base,
              document_auto_sync = EXCLUDED.document_auto_sync,
              trash_auto_cleanup_enabled = EXCLUDED.trash_auto_cleanup_enabled,
              trash_auto_cleanup_days = EXCLUDED.trash_auto_cleanup_days,
              document_block_shortcuts = EXCLUDED.document_block_shortcuts,
              updated_at = EXCLUDED.updated_at`,
          [
            normalizedUserId,
            next.useRemoteKnowledgeBase,
            next.documentAutoSync,
            next.trashAutoCleanupEnabled,
            next.trashAutoCleanupDays,
            next.documentBlockShortcuts,
            now,
            now,
          ],
        );

        dbAvailable = true;
        clearCache(normalizedUserId);
        return this.get(normalizedUserId);
      } catch (err) {
        if (isDbConnectionRefused(err)) {
          dbAvailable = false;
          throw new Error("Database not available");
        }
        throw err;
      }
    },

    clearCache,
  };
}

export const generalSettingsStore = createGeneralSettingsStore();

export function clearGeneralSettingsCache(userId?: string): void {
  generalSettingsStore.clearCache(userId);
}
