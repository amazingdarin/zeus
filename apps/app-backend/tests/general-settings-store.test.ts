import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createGeneralSettingsStore,
  type GeneralSettings,
} from "../src/services/general-settings-store.ts";
import { DEFAULT_DOCUMENT_BLOCK_SHORTCUTS } from "../src/services/general-settings-shortcuts.ts";

type Row = {
  user_id: string;
  use_remote_knowledge_base: boolean;
  document_auto_sync: boolean;
  trash_auto_cleanup_enabled: boolean;
  trash_auto_cleanup_days: number;
  document_block_shortcuts: Record<string, string>;
  created_at: Date;
  updated_at: Date;
};

function createMockQuery() {
  const table = new Map<string, Row>();

  const queryFn = async (sql: string, params: unknown[] = []) => {
    const normalized = sql.replace(/\s+/g, " ").trim().toLowerCase();

    if (
      normalized.startsWith("create table")
      || normalized.startsWith("create unique index")
      || normalized.startsWith("alter table user_general_settings")
    ) {
      return { rows: [] as Row[] };
    }

    if (normalized.startsWith("insert into user_general_settings")) {
      const userId = String(params[0] ?? "");
      const useRemoteKnowledgeBase = params[1] === true;
      const documentAutoSync = params[2] === true;
      const trashAutoCleanupEnabled = params[3] === true;
      const trashAutoCleanupDays = Number.isFinite(Number(params[4])) ? Number(params[4]) : 30;
      const documentBlockShortcuts =
        params[5] && typeof params[5] === "object" ? (params[5] as Record<string, string>) : {};
      const createdAt = params[6] instanceof Date ? params[6] : new Date();
      const updatedAt = params[7] instanceof Date ? params[7] : new Date();
      const existing = table.get(userId);
      table.set(userId, {
        user_id: userId,
        use_remote_knowledge_base: useRemoteKnowledgeBase,
        document_auto_sync: documentAutoSync,
        trash_auto_cleanup_enabled: trashAutoCleanupEnabled,
        trash_auto_cleanup_days: trashAutoCleanupDays,
        document_block_shortcuts: documentBlockShortcuts,
        created_at: existing?.created_at ?? createdAt,
        updated_at: updatedAt,
      });
      return { rows: [] as Row[] };
    }

    if (normalized.startsWith("select * from user_general_settings")) {
      const userId = String(params[0] ?? "");
      const row = table.get(userId);
      return { rows: row ? [row] : [] };
    }

    throw new Error(`unexpected sql: ${sql}`);
  };

  return { queryFn };
}

test("general-settings-store: returns defaults for missing user row", async () => {
  const { queryFn } = createMockQuery();
  const store = createGeneralSettingsStore({ queryFn });

  const settings = await store.get("user-1");

  assert.deepEqual(settings, {
    useRemoteKnowledgeBase: false,
    documentAutoSync: false,
    trashAutoCleanupEnabled: false,
    trashAutoCleanupDays: 30,
    documentBlockShortcuts: DEFAULT_DOCUMENT_BLOCK_SHORTCUTS,
  } satisfies GeneralSettings);
});

test("general-settings-store: keeps settings isolated per user", async () => {
  const { queryFn } = createMockQuery();
  const store = createGeneralSettingsStore({ queryFn });

  await store.update("user-a", {
    useRemoteKnowledgeBase: true,
    documentAutoSync: true,
    trashAutoCleanupEnabled: true,
    trashAutoCleanupDays: 90,
    documentBlockShortcuts: { "1": "heading-1" },
  });
  await store.update("user-b", {
    useRemoteKnowledgeBase: false,
    documentAutoSync: false,
    trashAutoCleanupEnabled: false,
    trashAutoCleanupDays: 15,
    documentBlockShortcuts: { p: "paragraph" },
  });

  const userA = await store.get("user-a");
  const userB = await store.get("user-b");

  assert.deepEqual(userA, {
    useRemoteKnowledgeBase: true,
    documentAutoSync: true,
    trashAutoCleanupEnabled: true,
    trashAutoCleanupDays: 90,
    documentBlockShortcuts: { "1": "heading-1" },
  } satisfies GeneralSettings);
  assert.deepEqual(userB, {
    useRemoteKnowledgeBase: false,
    documentAutoSync: false,
    trashAutoCleanupEnabled: false,
    trashAutoCleanupDays: 15,
    documentBlockShortcuts: { p: "paragraph" },
  } satisfies GeneralSettings);
});
