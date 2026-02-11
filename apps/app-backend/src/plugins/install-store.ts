import { query } from "../db/postgres.js";
import type {
  PluginInstallationRecord,
  PluginInstallationStatus,
} from "@zeus/plugin-sdk-shared";

type InstallationRow = {
  user_id: string;
  plugin_id: string;
  version: string;
  enabled: boolean;
  status: PluginInstallationStatus;
  installed_at: Date;
  updated_at: Date;
  last_error: string | null;
};

type SettingsRow = {
  user_id: string;
  plugin_id: string;
  settings_json: Record<string, unknown>;
  updated_at: Date;
};

function isTableMissing(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = "code" in err ? String((err as { code?: unknown }).code || "") : "";
  return code === "42P01";
}

function mapInstallation(row: InstallationRow): PluginInstallationRecord {
  return {
    userId: row.user_id,
    pluginId: row.plugin_id,
    version: row.version,
    enabled: row.enabled,
    status: row.status,
    installedAt: row.installed_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    lastError: row.last_error,
  };
}

export const pluginInstallStore = {
  async listByUser(userId: string): Promise<PluginInstallationRecord[]> {
    try {
      const result = await query<InstallationRow>(
        `SELECT *
           FROM plugin_user_installation
          WHERE user_id = $1
          ORDER BY updated_at DESC`,
        [userId],
      );
      return result.rows.map(mapInstallation);
    } catch (err) {
      if (isTableMissing(err)) return [];
      throw err;
    }
  },

  async get(userId: string, pluginId: string): Promise<PluginInstallationRecord | null> {
    try {
      const result = await query<InstallationRow>(
        `SELECT *
           FROM plugin_user_installation
          WHERE user_id = $1 AND plugin_id = $2`,
        [userId, pluginId],
      );
      return result.rows[0] ? mapInstallation(result.rows[0]) : null;
    } catch (err) {
      if (isTableMissing(err)) return null;
      throw err;
    }
  },

  async upsert(
    userId: string,
    pluginId: string,
    input: {
      version: string;
      enabled: boolean;
      status: PluginInstallationStatus;
      lastError?: string | null;
    },
  ): Promise<PluginInstallationRecord> {
    try {
      const result = await query<InstallationRow>(
        `INSERT INTO plugin_user_installation
          (user_id, plugin_id, version, enabled, status, installed_at, updated_at, last_error)
         VALUES ($1, $2, $3, $4, $5, now(), now(), $6)
         ON CONFLICT (user_id, plugin_id)
         DO UPDATE
            SET version = EXCLUDED.version,
                enabled = EXCLUDED.enabled,
                status = EXCLUDED.status,
                updated_at = now(),
                last_error = EXCLUDED.last_error
         RETURNING *`,
        [userId, pluginId, input.version, input.enabled, input.status, input.lastError ?? null],
      );

      return mapInstallation(result.rows[0]);
    } catch (err) {
      if (isTableMissing(err)) {
        throw new Error("plugin_user_installation table does not exist. Please run database migrations.");
      }
      throw err;
    }
  },

  async updateEnabled(userId: string, pluginId: string, enabled: boolean): Promise<PluginInstallationRecord | null> {
    try {
      const result = await query<InstallationRow>(
        `UPDATE plugin_user_installation
            SET enabled = $3,
                updated_at = now()
          WHERE user_id = $1
            AND plugin_id = $2
        RETURNING *`,
        [userId, pluginId, enabled],
      );
      return result.rows[0] ? mapInstallation(result.rows[0]) : null;
    } catch (err) {
      if (isTableMissing(err)) return null;
      throw err;
    }
  },

  async remove(userId: string, pluginId: string): Promise<boolean> {
    try {
      const result = await query(
        `DELETE FROM plugin_user_installation
          WHERE user_id = $1 AND plugin_id = $2`,
        [userId, pluginId],
      );
      return (result.rowCount ?? 0) > 0;
    } catch (err) {
      if (isTableMissing(err)) return false;
      throw err;
    }
  },

  async getSettings(userId: string, pluginId: string): Promise<Record<string, unknown> | null> {
    try {
      const result = await query<SettingsRow>(
        `SELECT user_id, plugin_id, settings_json, updated_at
           FROM plugin_user_settings
          WHERE user_id = $1 AND plugin_id = $2`,
        [userId, pluginId],
      );
      return result.rows[0]?.settings_json ?? null;
    } catch (err) {
      if (isTableMissing(err)) return null;
      throw err;
    }
  },

  async setSettings(userId: string, pluginId: string, settings: Record<string, unknown>): Promise<Record<string, unknown>> {
    try {
      const result = await query<SettingsRow>(
        `INSERT INTO plugin_user_settings (user_id, plugin_id, settings_json, updated_at)
         VALUES ($1, $2, $3::jsonb, now())
         ON CONFLICT (user_id, plugin_id)
         DO UPDATE SET settings_json = EXCLUDED.settings_json, updated_at = now()
         RETURNING user_id, plugin_id, settings_json, updated_at`,
        [userId, pluginId, JSON.stringify(settings)],
      );
      return result.rows[0]?.settings_json ?? {};
    } catch (err) {
      if (isTableMissing(err)) {
        throw new Error("plugin_user_settings table does not exist. Please run database migrations.");
      }
      throw err;
    }
  },

  async appendAudit(input: {
    userId: string;
    pluginId: string;
    operationId: string;
    projectScope: string;
    status: string;
    durationMs: number;
    error?: string;
  }): Promise<void> {
    try {
      await query(
        `INSERT INTO plugin_audit_log
          (id, user_id, plugin_id, operation_id, project_scope, status, duration_ms, error, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, now())`,
        [
          input.userId,
          input.pluginId,
          input.operationId,
          input.projectScope,
          input.status,
          Math.max(0, Math.round(input.durationMs)),
          input.error || null,
        ],
      );
    } catch (err) {
      if (isTableMissing(err)) {
        return;
      }
      throw err;
    }
  },
};
