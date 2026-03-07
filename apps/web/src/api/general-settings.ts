import { apiFetch } from "../config/api";
import {
  sanitizeDocumentBlockShortcuts,
  type DocumentBlockShortcutPayload,
} from "../constants/document-block-shortcuts";
import { normalizeTrashAutoCleanupDays } from "../features/settings/trash-settings";

export type GeneralSettings = {
  useRemoteKnowledgeBase: boolean;
  documentAutoSync: boolean;
  trashAutoCleanupEnabled: boolean;
  trashAutoCleanupDays: number;
  documentBlockShortcuts: DocumentBlockShortcutPayload;
  syncMode?: "local_only" | "remote_enabled";
};

export type GeneralSettingsInput = {
  useRemoteKnowledgeBase?: boolean;
  documentAutoSync?: boolean;
  trashAutoCleanupEnabled?: boolean;
  trashAutoCleanupDays?: number;
  documentBlockShortcuts?: DocumentBlockShortcutPayload;
};

export async function getGeneralSettings(): Promise<GeneralSettings> {
  const response = await apiFetch("/api/settings/general");
  if (!response.ok) {
    throw new Error("Failed to load general settings");
  }
  const payload = await response.json();
  const data = payload?.data ?? payload ?? {};
  return {
    useRemoteKnowledgeBase: Boolean(data.useRemoteKnowledgeBase ?? false),
    documentAutoSync: Boolean(data.documentAutoSync ?? false),
    trashAutoCleanupEnabled: Boolean(data.trashAutoCleanupEnabled ?? false),
    trashAutoCleanupDays: normalizeTrashAutoCleanupDays(data.trashAutoCleanupDays, 30),
    documentBlockShortcuts: sanitizeDocumentBlockShortcuts(
      data.documentBlockShortcuts
    ),
    syncMode: data.syncMode === "remote_enabled" ? "remote_enabled" : "local_only",
  };
}

export async function updateGeneralSettings(input: GeneralSettingsInput): Promise<GeneralSettings> {
  const body: Record<string, unknown> = {};
  if (typeof input.useRemoteKnowledgeBase === "boolean") {
    body.use_remote_knowledge_base = input.useRemoteKnowledgeBase;
  }
  if (typeof input.documentAutoSync === "boolean") {
    body.document_auto_sync = input.documentAutoSync;
  }
  if (typeof input.trashAutoCleanupEnabled === "boolean") {
    body.trash_auto_cleanup_enabled = input.trashAutoCleanupEnabled;
  }
  if (typeof input.trashAutoCleanupDays === "number" && Number.isFinite(input.trashAutoCleanupDays)) {
    body.trash_auto_cleanup_days = normalizeTrashAutoCleanupDays(input.trashAutoCleanupDays, 30);
  }
  if (input.documentBlockShortcuts && typeof input.documentBlockShortcuts === "object") {
    body.document_block_shortcuts = input.documentBlockShortcuts;
  }

  const response = await apiFetch("/api/settings/general", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message || "Failed to save general settings");
  }
  const payload = await response.json();
  const data = payload?.data ?? payload ?? {};
  return {
    useRemoteKnowledgeBase: Boolean(data.useRemoteKnowledgeBase ?? false),
    documentAutoSync: Boolean(data.documentAutoSync ?? false),
    trashAutoCleanupEnabled: Boolean(data.trashAutoCleanupEnabled ?? false),
    trashAutoCleanupDays: normalizeTrashAutoCleanupDays(data.trashAutoCleanupDays, 30),
    documentBlockShortcuts: sanitizeDocumentBlockShortcuts(
      data.documentBlockShortcuts
    ),
    syncMode: data.syncMode === "remote_enabled" ? "remote_enabled" : "local_only",
  };
}
