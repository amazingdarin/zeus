import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";

import { documentStore, DocumentNotFoundError } from "../../storage/document-store.js";
import { indexManager } from "../../storage/index-manager.js";
import { getScopedDocsRoot, buildCacheKey } from "../../storage/paths.js";
import type { Document } from "../../storage/types.js";
import type {
  DocumentTrashEntry,
  DocumentTrashSnapshot,
  DocumentTrashStore,
  MoveToTrashInput,
  MoveToTrashResult,
  PurgeAllTrashInput,
  PurgeAllTrashResult,
  PurgeOneTrashInput,
  PurgeOneTrashResult,
  GetTrashSnapshotInput,
  RestoreTrashInput,
  RestoreTrashResult,
  SweepExpiredTrashInput,
  SweepExpiredTrashResult,
} from "./types.js";

const TRASH_DIR_NAME = ".trash";
const TRASH_ENTRIES_DIR_NAME = "entries";
const TRASH_INDEX_FILE_NAME = "index.json";
const TRASH_SNAPSHOT_FILE_NAME = "snapshot.json";

function docsRoot(userId: string, projectKey: string): string {
  return getScopedDocsRoot(userId, projectKey);
}

function trashRoot(userId: string, projectKey: string): string {
  return path.join(docsRoot(userId, projectKey), TRASH_DIR_NAME);
}

function trashEntriesRoot(userId: string, projectKey: string): string {
  return path.join(trashRoot(userId, projectKey), TRASH_ENTRIES_DIR_NAME);
}

function trashIndexPath(userId: string, projectKey: string): string {
  return path.join(trashRoot(userId, projectKey), TRASH_INDEX_FILE_NAME);
}

function trashSnapshotPath(userId: string, projectKey: string, trashId: string): string {
  return path.join(trashEntriesRoot(userId, projectKey), trashId, TRASH_SNAPSHOT_FILE_NAME);
}

function cacheKey(userId: string, projectKey: string): string {
  return buildCacheKey(userId, projectKey);
}

async function ensureTrashDirs(userId: string, projectKey: string): Promise<void> {
  await mkdir(docsRoot(userId, projectKey), { recursive: true });
  await mkdir(trashEntriesRoot(userId, projectKey), { recursive: true });
}

async function readTrashIndex(userId: string, projectKey: string): Promise<DocumentTrashEntry[]> {
  try {
    const content = await readFile(trashIndexPath(userId, projectKey), "utf-8");
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item) => item && typeof item === "object").map((item) => {
      const row = item as Partial<DocumentTrashEntry>;
      return {
        trashId: String(row.trashId ?? "").trim(),
        rootDocId: String(row.rootDocId ?? "").trim(),
        title: String(row.title ?? "").trim(),
        entityType: row.entityType === "directory" ? "directory" : "document",
        originalPath: String(row.originalPath ?? "").trim(),
        originalParentId: String(row.originalParentId ?? "root").trim() || "root",
        deletedAt: String(row.deletedAt ?? ""),
        deletedBy: String(row.deletedBy ?? ""),
        deletedIds: Array.isArray(row.deletedIds)
          ? row.deletedIds.map((id) => String(id).trim()).filter(Boolean)
          : [],
      } satisfies DocumentTrashEntry;
    }).filter((row) => row.trashId && row.rootDocId);
  } catch {
    return [];
  }
}

async function writeTrashIndex(userId: string, projectKey: string, entries: DocumentTrashEntry[]): Promise<void> {
  const indexPath = trashIndexPath(userId, projectKey);
  const tmpPath = `${indexPath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(entries, null, 2), "utf-8");
  await rename(tmpPath, indexPath);
}

function restoreTitle(baseTitle: string, siblingTitles: Set<string>): string {
  const normalizedBase = baseTitle.trim() || "无标题文档";
  if (!siblingTitles.has(normalizedBase)) {
    return normalizedBase;
  }

  const first = `${normalizedBase}（恢复）`;
  if (!siblingTitles.has(first)) {
    return first;
  }

  let seq = 2;
  while (siblingTitles.has(`${normalizedBase}（恢复${seq}）`)) {
    seq += 1;
  }
  return `${normalizedBase}（恢复${seq}）`;
}

function sortDocsForRestore(docs: Document[]): Document[] {
  return [...docs].sort((a, b) => {
    const aParent = String(a.meta?.parent_id ?? "").trim();
    const bParent = String(b.meta?.parent_id ?? "").trim();
    if ((aParent === "" || aParent === "root") && bParent !== "" && bParent !== "root") {
      return -1;
    }
    if ((bParent === "" || bParent === "root") && aParent !== "" && aParent !== "root") {
      return 1;
    }

    const aDepth = String(a.meta?.path ?? "").split("/").length;
    const bDepth = String(b.meta?.path ?? "").split("/").length;
    return aDepth - bDepth;
  });
}

async function readSnapshot(userId: string, projectKey: string, trashId: string): Promise<DocumentTrashSnapshot> {
  const content = await readFile(trashSnapshotPath(userId, projectKey, trashId), "utf-8");
  const parsed = JSON.parse(content) as Partial<DocumentTrashSnapshot>;
  const docs = Array.isArray(parsed.docs) ? parsed.docs as Document[] : [];
  const rootDocId = String(parsed.rootDocId ?? "").trim();
  if (!rootDocId || docs.length === 0) {
    throw new Error(`Invalid trash snapshot: ${trashId}`);
  }
  return {
    rootDocId,
    docs,
  };
}

async function removeTrashEntryData(userId: string, projectKey: string, trashId: string): Promise<void> {
  const entryDir = path.join(trashEntriesRoot(userId, projectKey), trashId);
  await rm(entryDir, { recursive: true, force: true });
}

function findEntry(entries: DocumentTrashEntry[], trashId: string): DocumentTrashEntry {
  const entry = entries.find((item) => item.trashId === trashId);
  if (!entry) {
    throw new DocumentNotFoundError(trashId);
  }
  return entry;
}

export function createDocumentTrashStore(): DocumentTrashStore {
  return {
    async moveToTrash(input: MoveToTrashInput): Promise<MoveToTrashResult> {
      const normalizedDocId = String(input.docId ?? "").trim();
      if (!normalizedDocId) {
        throw new Error("docId is required");
      }
      await ensureTrashDirs(input.userId, input.projectKey);

      const rootDoc = await documentStore.get(input.userId, input.projectKey, normalizedDocId);
      const descendants = await documentStore.collectAllDescendantIds(input.userId, input.projectKey, normalizedDocId);
      const deletedSet = new Set<string>([normalizedDocId, ...descendants]);
      const deletedIds = Array.from(deletedSet);

      const docs: Document[] = [];
      for (const id of deletedIds) {
        docs.push(await documentStore.get(input.userId, input.projectKey, id));
      }

      const trashId = uuidv4();
      const deletedAt = new Date().toISOString();
      const entry: DocumentTrashEntry = {
        trashId,
        rootDocId: normalizedDocId,
        title: String(rootDoc.meta.title ?? "").trim() || "无标题文档",
        entityType: descendants.length > 0 ? "directory" : "document",
        originalPath: String(rootDoc.meta.path ?? "").trim(),
        originalParentId: String(rootDoc.meta.parent_id ?? "root").trim() || "root",
        deletedAt,
        deletedBy: String(input.deletedBy ?? "").trim(),
        deletedIds,
      };

      const entryDir = path.join(trashEntriesRoot(input.userId, input.projectKey), trashId);
      await mkdir(entryDir, { recursive: true });
      const snapshot: DocumentTrashSnapshot = {
        rootDocId: normalizedDocId,
        docs,
      };
      await writeFile(
        path.join(entryDir, TRASH_SNAPSHOT_FILE_NAME),
        JSON.stringify(snapshot),
        "utf-8",
      );

      try {
        await documentStore.delete(input.userId, input.projectKey, normalizedDocId, true);
      } catch (err) {
        await rm(entryDir, { recursive: true, force: true });
        throw err;
      }

      const entries = await readTrashIndex(input.userId, input.projectKey);
      entries.unshift(entry);
      await writeTrashIndex(input.userId, input.projectKey, entries);

      return { entry, deletedIds };
    },

    async list(input) {
      await ensureTrashDirs(input.userId, input.projectKey);
      const entries = await readTrashIndex(input.userId, input.projectKey);
      return entries.sort((a, b) => {
        return new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime();
      });
    },

    async getSnapshot(input: GetTrashSnapshotInput): Promise<DocumentTrashSnapshot> {
      await ensureTrashDirs(input.userId, input.projectKey);
      const entries = await readTrashIndex(input.userId, input.projectKey);
      const entry = findEntry(entries, input.trashId);
      return readSnapshot(input.userId, input.projectKey, entry.trashId);
    },

    async restore(input: RestoreTrashInput): Promise<RestoreTrashResult> {
      await ensureTrashDirs(input.userId, input.projectKey);
      const entries = await readTrashIndex(input.userId, input.projectKey);
      const entry = findEntry(entries, input.trashId);
      const snapshot = await readSnapshot(input.userId, input.projectKey, entry.trashId);
      const sortedDocs = sortDocsForRestore(snapshot.docs);

      let targetParentId = entry.originalParentId || "root";
      let fallbackToRoot = false;
      if (targetParentId !== "root") {
        try {
          await documentStore.get(input.userId, input.projectKey, targetParentId);
        } catch (err) {
          if (err instanceof DocumentNotFoundError) {
            targetParentId = "root";
            fallbackToRoot = true;
          } else {
            throw err;
          }
        }
      }

      const ck = cacheKey(input.userId, input.projectKey);
      await indexManager.ensure(ck, docsRoot(input.userId, input.projectKey));
      const siblingTitles = indexManager.getSiblingTitles(ck, targetParentId, entry.rootDocId);

      let restoredRoot: Document | null = null;
      const restoredIds: string[] = [];
      const resolvedRootTitle = restoreTitle(entry.title, siblingTitles);
      for (const sourceDoc of sortedDocs) {
        const doc: Document = JSON.parse(JSON.stringify(sourceDoc)) as Document;
        doc.meta.path = "";
        doc.meta.created_at = "";
        doc.meta.updated_at = "";

        if (doc.meta.id === entry.rootDocId) {
          doc.meta.parent_id = targetParentId;
          doc.meta.title = resolvedRootTitle;
        }

        const saved = await documentStore.save(input.userId, input.projectKey, doc);
        restoredIds.push(saved.meta.id);
        if (saved.meta.id === entry.rootDocId) {
          restoredRoot = saved;
        }
      }

      if (!restoredRoot) {
        throw new Error(`Failed to restore root document: ${entry.rootDocId}`);
      }

      const nextEntries = entries.filter((item) => item.trashId !== entry.trashId);
      await writeTrashIndex(input.userId, input.projectKey, nextEntries);
      await removeTrashEntryData(input.userId, input.projectKey, entry.trashId);

      return {
        root: restoredRoot,
        fallbackToRoot,
        restoredIds,
      };
    },

    async purgeOne(input: PurgeOneTrashInput): Promise<PurgeOneTrashResult> {
      await ensureTrashDirs(input.userId, input.projectKey);
      const entries = await readTrashIndex(input.userId, input.projectKey);
      const target = entries.find((item) => item.trashId === input.trashId);
      if (!target) {
        return { purged: false };
      }
      const nextEntries = entries.filter((item) => item.trashId !== input.trashId);
      await writeTrashIndex(input.userId, input.projectKey, nextEntries);
      await removeTrashEntryData(input.userId, input.projectKey, input.trashId);
      return { purged: true };
    },

    async purgeAll(input: PurgeAllTrashInput): Promise<PurgeAllTrashResult> {
      await ensureTrashDirs(input.userId, input.projectKey);
      const entries = await readTrashIndex(input.userId, input.projectKey);
      const count = entries.length;

      await rm(trashEntriesRoot(input.userId, input.projectKey), { recursive: true, force: true });
      await mkdir(trashEntriesRoot(input.userId, input.projectKey), { recursive: true });
      await writeTrashIndex(input.userId, input.projectKey, []);

      return { count };
    },

    async sweepExpired(input: SweepExpiredTrashInput): Promise<SweepExpiredTrashResult> {
      const days = Number.isFinite(input.maxAgeDays) && input.maxAgeDays > 0
        ? Math.floor(input.maxAgeDays)
        : 30;
      const threshold = Date.now() - days * 24 * 60 * 60 * 1000;

      const entries = await readTrashIndex(input.userId, input.projectKey);
      const toDelete = entries.filter((entry) => {
        const ts = new Date(entry.deletedAt).getTime();
        return Number.isFinite(ts) && ts <= threshold;
      });
      if (toDelete.length === 0) {
        return { count: 0 };
      }

      const nextEntries = entries.filter((entry) => !toDelete.some((row) => row.trashId === entry.trashId));
      await writeTrashIndex(input.userId, input.projectKey, nextEntries);

      for (const entry of toDelete) {
        await removeTrashEntryData(input.userId, input.projectKey, entry.trashId);
      }
      return { count: toDelete.length };
    },
  };
}

export const documentTrashStore = createDocumentTrashStore();
