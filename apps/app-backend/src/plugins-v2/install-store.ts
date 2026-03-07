import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { query } from "../db/postgres.js";
import type { PluginActivationV2, PluginInstallationRecordV2, PluginInstallationStatus } from "@zeus/plugin-sdk-shared";
import {
  getUserPluginInstalledConfigPath,
  getUserPluginSettingsPath,
} from "../storage/paths.js";

type InstallationRow = {
  user_id: string;
  plugin_id: string;
  version: string;
  enabled: boolean;
  status: PluginInstallationStatus;
  installed_at: Date;
  updated_at: Date;
  last_error: string | null;
  manifest_api_version: number | null;
  capabilities_json: unknown;
  activation_json: unknown;
};

type SettingsRow = {
  user_id: string;
  plugin_id: string;
  settings_json: Record<string, unknown>;
};

type InstalledConfigFile = {
  schemaVersion: 1;
  updatedAt: string;
  installations: Record<string, PluginInstallationRecordV2>;
};

function isTableMissing(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = "code" in err ? String((err as { code?: unknown }).code || "") : "";
  return code === "42P01";
}

function mapInstallation(row: InstallationRow): PluginInstallationRecordV2 {
  return {
    userId: row.user_id,
    pluginId: row.plugin_id,
    version: row.version,
    enabled: row.enabled,
    status: row.status,
    installedAt: row.installed_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    lastError: row.last_error,
    manifestApiVersion: Number(row.manifest_api_version || 0) || undefined,
    capabilities: Array.isArray(row.capabilities_json)
      ? row.capabilities_json.map((item) => String(item || "").trim()).filter(Boolean)
      : undefined,
    activation: row.activation_json && typeof row.activation_json === "object"
      ? row.activation_json as PluginActivationV2
      : undefined,
  };
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const content = await readFile(filePath, "utf8");
    if (!content.trim()) {
      return null;
    }
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

async function readInstalledConfig(userId: string): Promise<InstalledConfigFile> {
  const filePath = getUserPluginInstalledConfigPath(userId);
  const fromDisk = await readJsonFile<InstalledConfigFile>(filePath);
  if (fromDisk && fromDisk.installations && typeof fromDisk.installations === "object") {
    return {
      schemaVersion: 1,
      updatedAt: fromDisk.updatedAt || new Date().toISOString(),
      installations: fromDisk.installations,
    };
  }
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    installations: {},
  };
}

async function writeInstalledConfig(
  userId: string,
  mutate: (current: InstalledConfigFile) => InstalledConfigFile,
): Promise<void> {
  const current = await readInstalledConfig(userId);
  const next = mutate(current);
  next.schemaVersion = 1;
  next.updatedAt = new Date().toISOString();
  await writeJsonFile(getUserPluginInstalledConfigPath(userId), next);
}

async function readLocalSettings(userId: string, pluginId: string): Promise<Record<string, unknown> | null> {
  const filePath = getUserPluginSettingsPath(userId, pluginId);
  const value = await readJsonFile<Record<string, unknown>>(filePath);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value;
}

async function writeLocalSettings(
  userId: string,
  pluginId: string,
  settings: Record<string, unknown>,
): Promise<void> {
  const filePath = getUserPluginSettingsPath(userId, pluginId);
  await writeJsonFile(filePath, settings);
}

export const pluginInstallStoreV2 = {
  async listByUser(userId: string): Promise<PluginInstallationRecordV2[]> {
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
      if (isTableMissing(err)) {
        const fromDisk = await readInstalledConfig(userId);
        return Object.values(fromDisk.installations || {}).sort((a, b) => {
          const left = String(a.updatedAt || "");
          const right = String(b.updatedAt || "");
          return right.localeCompare(left);
        });
      }
      throw err;
    }
  },

  async listEnabled(): Promise<PluginInstallationRecordV2[]> {
    try {
      const result = await query<InstallationRow>(
        `SELECT *
           FROM plugin_user_installation
          WHERE status = 'installed' AND enabled = true
          ORDER BY updated_at DESC`,
      );
      return result.rows.map(mapInstallation);
    } catch (err) {
      if (isTableMissing(err)) return [];
      throw err;
    }
  },

  async get(userId: string, pluginId: string): Promise<PluginInstallationRecordV2 | null> {
    try {
      const result = await query<InstallationRow>(
        `SELECT *
           FROM plugin_user_installation
          WHERE user_id = $1 AND plugin_id = $2`,
        [userId, pluginId],
      );
      return result.rows[0] ? mapInstallation(result.rows[0]) : null;
    } catch (err) {
      if (isTableMissing(err)) {
        const fromDisk = await readInstalledConfig(userId);
        return fromDisk.installations?.[pluginId] || null;
      }
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
      manifestApiVersion?: number;
      capabilities?: string[];
      activation?: PluginActivationV2;
    },
  ): Promise<PluginInstallationRecordV2> {
    try {
      const result = await query<InstallationRow>(
        `INSERT INTO plugin_user_installation
          (user_id, plugin_id, version, enabled, status, installed_at, updated_at, last_error,
           manifest_api_version, capabilities_json, activation_json)
         VALUES ($1, $2, $3, $4, $5, now(), now(), $6, $7, $8::jsonb, $9::jsonb)
         ON CONFLICT (user_id, plugin_id)
         DO UPDATE
            SET version = EXCLUDED.version,
                enabled = EXCLUDED.enabled,
                status = EXCLUDED.status,
                updated_at = now(),
                last_error = EXCLUDED.last_error,
                manifest_api_version = EXCLUDED.manifest_api_version,
                capabilities_json = EXCLUDED.capabilities_json,
                activation_json = EXCLUDED.activation_json
         RETURNING *`,
        [
          userId,
          pluginId,
          input.version,
          input.enabled,
          input.status,
          input.lastError ?? null,
          input.manifestApiVersion ?? null,
          JSON.stringify(input.capabilities || []),
          JSON.stringify(input.activation || {}),
        ],
      );
      const record = mapInstallation(result.rows[0]);
      await writeInstalledConfig(userId, (current) => ({
        ...current,
        installations: {
          ...current.installations,
          [record.pluginId]: record,
        },
      }));
      return record;
    } catch (err) {
      if (isTableMissing(err)) {
        const now = new Date().toISOString();
        const fallback: PluginInstallationRecordV2 = {
          userId,
          pluginId,
          version: input.version,
          enabled: input.enabled,
          status: input.status,
          installedAt: now,
          updatedAt: now,
          lastError: input.lastError ?? null,
          manifestApiVersion: input.manifestApiVersion,
          capabilities: input.capabilities || [],
          activation: input.activation || {},
        };
        await writeInstalledConfig(userId, (current) => ({
          ...current,
          installations: {
            ...current.installations,
            [fallback.pluginId]: fallback,
          },
        }));
        return fallback;
      }
      throw err;
    }
  },

  async updateEnabled(userId: string, pluginId: string, enabled: boolean): Promise<PluginInstallationRecordV2 | null> {
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
      const mapped = result.rows[0] ? mapInstallation(result.rows[0]) : null;
      if (mapped) {
        await writeInstalledConfig(userId, (current) => ({
          ...current,
          installations: {
            ...current.installations,
            [mapped.pluginId]: mapped,
          },
        }));
      }
      return mapped;
    } catch (err) {
      if (isTableMissing(err)) {
        const current = await readInstalledConfig(userId);
        const existing = current.installations?.[pluginId];
        if (!existing) return null;
        const updated: PluginInstallationRecordV2 = {
          ...existing,
          enabled,
          updatedAt: new Date().toISOString(),
        };
        await writeInstalledConfig(userId, (state) => ({
          ...state,
          installations: {
            ...state.installations,
            [pluginId]: updated,
          },
        }));
        return updated;
      }
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
      await writeInstalledConfig(userId, (current) => {
        const nextInstallations = { ...current.installations };
        delete nextInstallations[pluginId];
        return {
          ...current,
          installations: nextInstallations,
        };
      });
      return (result.rowCount ?? 0) > 0;
    } catch (err) {
      if (isTableMissing(err)) {
        const current = await readInstalledConfig(userId);
        const exists = Boolean(current.installations?.[pluginId]);
        await writeInstalledConfig(userId, (state) => {
          const nextInstallations = { ...state.installations };
          delete nextInstallations[pluginId];
          return {
            ...state,
            installations: nextInstallations,
          };
        });
        return exists;
      }
      throw err;
    }
  },

  async getSettings(userId: string, pluginId: string): Promise<Record<string, unknown> | null> {
    const local = await readLocalSettings(userId, pluginId);
    if (local) {
      return local;
    }

    try {
      const result = await query<SettingsRow>(
        `SELECT user_id, plugin_id, settings_json
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
    await writeLocalSettings(userId, pluginId, settings);

    try {
      const result = await query<SettingsRow>(
        `INSERT INTO plugin_user_settings (user_id, plugin_id, settings_json, updated_at)
         VALUES ($1, $2, $3::jsonb, now())
         ON CONFLICT (user_id, plugin_id)
         DO UPDATE SET settings_json = EXCLUDED.settings_json, updated_at = now()
         RETURNING user_id, plugin_id, settings_json`,
        [userId, pluginId, JSON.stringify(settings)],
      );
      return result.rows[0]?.settings_json ?? {};
    } catch (err) {
      if (isTableMissing(err)) {
        return settings;
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
    eventType?: string;
    hookStage?: "before" | "after";
    decision?: string;
    requestId?: string;
  }): Promise<void> {
    try {
      await query(
        `INSERT INTO plugin_audit_log
          (id, user_id, plugin_id, operation_id, project_scope, status, duration_ms, error,
           event_type, hook_stage, decision, request_id, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())`,
        [
          input.userId,
          input.pluginId,
          input.operationId,
          input.projectScope,
          input.status,
          Math.max(0, Math.round(input.durationMs)),
          input.error || null,
          input.eventType || "operation",
          input.hookStage || null,
          input.decision || null,
          input.requestId || null,
        ],
      );
    } catch (err) {
      if (isTableMissing(err)) return;
      throw err;
    }
  },
};
