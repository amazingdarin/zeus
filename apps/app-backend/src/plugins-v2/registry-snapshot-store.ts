import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { query } from "../db/postgres.js";
import type { PluginRegisteredCommandV2 } from "@zeus/plugin-sdk-shared";
import { getUserPluginRegistrySnapshotPath } from "../storage/paths.js";

type SnapshotRow = {
  user_id: string;
  plugin_id: string;
  version: string;
  commands_json: unknown;
  hooks_json: unknown;
  routes_json: unknown;
  tools_json: unknown;
  updated_at: Date;
};

function isTableMissing(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = "code" in err ? String((err as { code?: unknown }).code || "") : "";
  return code === "42P01";
}

export type PluginRegistrySnapshotRecord = {
  userId: string;
  pluginId: string;
  version: string;
  commands: PluginRegisteredCommandV2[];
  hooks: Array<Record<string, unknown>>;
  routes: Array<Record<string, unknown>>;
  tools: Array<Record<string, unknown>>;
  updatedAt: string;
};

type SnapshotFile = {
  schemaVersion: 1;
  updatedAt: string;
  snapshots: Record<string, PluginRegistrySnapshotRecord>;
};

function mapSnapshot(row: SnapshotRow): PluginRegistrySnapshotRecord {
  return {
    userId: row.user_id,
    pluginId: row.plugin_id,
    version: row.version,
    commands: Array.isArray(row.commands_json)
      ? row.commands_json as PluginRegisteredCommandV2[]
      : [],
    hooks: Array.isArray(row.hooks_json)
      ? row.hooks_json as Array<Record<string, unknown>>
      : [],
    routes: Array.isArray(row.routes_json)
      ? row.routes_json as Array<Record<string, unknown>>
      : [],
    tools: Array.isArray(row.tools_json)
      ? row.tools_json as Array<Record<string, unknown>>
      : [],
    updatedAt: row.updated_at.toISOString(),
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

async function readSnapshotFile(userId: string): Promise<SnapshotFile> {
  const filePath = getUserPluginRegistrySnapshotPath(userId);
  const fromDisk = await readJsonFile<SnapshotFile>(filePath);
  if (fromDisk && fromDisk.snapshots && typeof fromDisk.snapshots === "object") {
    return {
      schemaVersion: 1,
      updatedAt: fromDisk.updatedAt || new Date().toISOString(),
      snapshots: fromDisk.snapshots,
    };
  }
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    snapshots: {},
  };
}

async function writeSnapshotFile(
  userId: string,
  mutate: (current: SnapshotFile) => SnapshotFile,
): Promise<void> {
  const current = await readSnapshotFile(userId);
  const next = mutate(current);
  next.schemaVersion = 1;
  next.updatedAt = new Date().toISOString();
  await writeJsonFile(getUserPluginRegistrySnapshotPath(userId), next);
}

export const pluginRegistrySnapshotStore = {
  async upsert(input: {
    userId: string;
    pluginId: string;
    version: string;
    commands: PluginRegisteredCommandV2[];
    hooks: Array<Record<string, unknown>>;
    routes: Array<Record<string, unknown>>;
    tools: Array<Record<string, unknown>>;
  }): Promise<void> {
    const nextRecord: PluginRegistrySnapshotRecord = {
      userId: input.userId,
      pluginId: input.pluginId,
      version: input.version,
      commands: input.commands || [],
      hooks: input.hooks || [],
      routes: input.routes || [],
      tools: input.tools || [],
      updatedAt: new Date().toISOString(),
    };

    try {
      await query(
        `INSERT INTO plugin_user_registry_snapshot
          (user_id, plugin_id, version, commands_json, hooks_json, routes_json, tools_json, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, now())
         ON CONFLICT (user_id, plugin_id)
         DO UPDATE
            SET version = EXCLUDED.version,
                commands_json = EXCLUDED.commands_json,
                hooks_json = EXCLUDED.hooks_json,
                routes_json = EXCLUDED.routes_json,
                tools_json = EXCLUDED.tools_json,
                updated_at = now()`,
        [
          input.userId,
          input.pluginId,
          input.version,
          JSON.stringify(input.commands || []),
          JSON.stringify(input.hooks || []),
          JSON.stringify(input.routes || []),
          JSON.stringify(input.tools || []),
        ],
      );
    } catch (err) {
      if (!isTableMissing(err)) {
        throw err;
      }
    }

    await writeSnapshotFile(input.userId, (current) => ({
      ...current,
      snapshots: {
        ...current.snapshots,
        [input.pluginId]: nextRecord,
      },
    }));
  },

  async remove(userId: string, pluginId: string): Promise<void> {
    try {
      await query(
        `DELETE FROM plugin_user_registry_snapshot
          WHERE user_id = $1 AND plugin_id = $2`,
        [userId, pluginId],
      );
    } catch (err) {
      if (!isTableMissing(err)) {
        throw err;
      }
    }

    await writeSnapshotFile(userId, (current) => {
      const nextSnapshots = { ...current.snapshots };
      delete nextSnapshots[pluginId];
      return {
        ...current,
        snapshots: nextSnapshots,
      };
    });
  },

  async listByUser(userId: string): Promise<PluginRegistrySnapshotRecord[]> {
    try {
      const result = await query<SnapshotRow>(
        `SELECT *
           FROM plugin_user_registry_snapshot
          WHERE user_id = $1
          ORDER BY updated_at DESC`,
        [userId],
      );
      return result.rows.map(mapSnapshot);
    } catch (err) {
      if (!isTableMissing(err)) {
        throw err;
      }
      const fromDisk = await readSnapshotFile(userId);
      return Object.values(fromDisk.snapshots || {}).sort((a, b) => {
        const left = String(a.updatedAt || "");
        const right = String(b.updatedAt || "");
        return right.localeCompare(left);
      });
    }
  },

  async get(userId: string, pluginId: string): Promise<PluginRegistrySnapshotRecord | null> {
    try {
      const result = await query<SnapshotRow>(
        `SELECT *
           FROM plugin_user_registry_snapshot
          WHERE user_id = $1 AND plugin_id = $2`,
        [userId, pluginId],
      );
      return result.rows[0] ? mapSnapshot(result.rows[0]) : null;
    } catch (err) {
      if (!isTableMissing(err)) {
        throw err;
      }
      const fromDisk = await readSnapshotFile(userId);
      return fromDisk.snapshots?.[pluginId] || null;
    }
  },
};
