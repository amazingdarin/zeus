/**
 * Document Tree Sync Manager
 *
 * This module handles synchronization between document tree changes
 * and the knowledge index. Key responsibilities:
 * - Track document move events
 * - Update index metadata (paths) when documents move
 * - Debounce batch updates for efficiency
 * - Clear affected summary caches
 */

import { query } from "../db/postgres.js";
import { documentStore } from "../storage/document-store.js";
import { clearSummaryCache } from "./hierarchy.js";

// ============================================================
// Configuration
// ============================================================

const DEBOUNCE_MS = 5000; // 5 seconds
const MAX_WAIT_MS = 30000; // 30 seconds max wait

// ============================================================
// Types
// ============================================================

export interface DocMoveEvent {
  userId: string;
  projectKey: string;
  docId: string;
  oldParentId: string | null;
  newParentId: string | null;
  timestamp: number;
}

export interface DocDeleteEvent {
  userId: string;
  projectKey: string;
  docId: string;
  timestamp: number;
}

export interface DocUpdateEvent {
  userId: string;
  projectKey: string;
  docId: string;
  timestamp: number;
}

type SyncEvent = DocMoveEvent | DocDeleteEvent | DocUpdateEvent;

// ============================================================
// Tree Sync Manager
// ============================================================

class TreeSyncManager {
  private pendingUpdates: Map<string, Set<string>> = new Map();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private maxWaitTimers: Map<string, NodeJS.Timeout> = new Map();
  private eventQueues: Map<string, SyncEvent[]> = new Map();

  /**
   * Handle a document move event
   */
  async onDocumentMoved(event: DocMoveEvent): Promise<void> {
    const key = this.getKey(event.userId, event.projectKey);

    // Add to pending updates
    this.addToPending(key, event.docId);

    // Also add all descendants
    try {
      const descendants = await this.collectDescendants(
        event.userId,
        event.projectKey,
        event.docId,
      );
      for (const descId of descendants) {
        this.addToPending(key, descId);
      }
    } catch (err) {
      console.warn("[TreeSync] Failed to collect descendants:", err);
    }

    // Queue the event
    this.queueEvent(key, event);

    // Schedule debounced sync
    this.scheduleSync(key, event.userId, event.projectKey);
  }

  /**
   * Handle a document deletion event
   */
  async onDocumentDeleted(event: DocDeleteEvent): Promise<void> {
    const key = this.getKey(event.userId, event.projectKey);

    // Remove from index immediately for deletes
    await this.removeFromIndex(event.userId, event.projectKey, event.docId);

    // Clear any pending updates for this document
    const pending = this.pendingUpdates.get(key);
    if (pending) {
      pending.delete(event.docId);
    }

    // Clear summary cache
    await clearSummaryCache(event.docId);
  }

  /**
   * Handle a document content update event
   */
  onDocumentUpdated(event: DocUpdateEvent): void {
    const key = this.getKey(event.userId, event.projectKey);

    // Add to pending updates
    this.addToPending(key, event.docId);

    // Queue the event
    this.queueEvent(key, event);

    // Schedule debounced sync
    this.scheduleSync(key, event.userId, event.projectKey);
  }

  /**
   * Force immediate sync for a project (useful for batch operations)
   */
  async forceSync(userId: string, projectKey: string): Promise<void> {
    const key = this.getKey(userId, projectKey);

    // Clear timers
    this.clearTimers(key);

    // Execute sync
    await this.executeSync(userId, projectKey);
  }

  /**
   * Get pending update count for a project
   */
  getPendingCount(userId: string, projectKey: string): number {
    const key = this.getKey(userId, projectKey);
    return this.pendingUpdates.get(key)?.size || 0;
  }

  // ============================================================
  // Internal Methods
  // ============================================================

  private getKey(userId: string, projectKey: string): string {
    return `${userId}:${projectKey}`;
  }

  private addToPending(key: string, docId: string): void {
    let pending = this.pendingUpdates.get(key);
    if (!pending) {
      pending = new Set();
      this.pendingUpdates.set(key, pending);
    }
    pending.add(docId);
  }

  private queueEvent(key: string, event: SyncEvent): void {
    let queue = this.eventQueues.get(key);
    if (!queue) {
      queue = [];
      this.eventQueues.set(key, queue);
    }
    queue.push(event);
  }

  private scheduleSync(key: string, userId: string, projectKey: string): void {
    // Clear existing debounce timer
    const existingTimer = this.debounceTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new debounce timer
    const timer = setTimeout(() => {
      this.executeSync(userId, projectKey).catch((err) => {
        console.error("[TreeSync] Sync failed:", err);
      });
    }, DEBOUNCE_MS);
    this.debounceTimers.set(key, timer);

    // Set max wait timer if not already set
    if (!this.maxWaitTimers.has(key)) {
      const maxTimer = setTimeout(() => {
        this.executeSync(userId, projectKey).catch((err) => {
          console.error("[TreeSync] Max wait sync failed:", err);
        });
      }, MAX_WAIT_MS);
      this.maxWaitTimers.set(key, maxTimer);
    }
  }

  private clearTimers(key: string): void {
    const debounceTimer = this.debounceTimers.get(key);
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      this.debounceTimers.delete(key);
    }

    const maxWaitTimer = this.maxWaitTimers.get(key);
    if (maxWaitTimer) {
      clearTimeout(maxWaitTimer);
      this.maxWaitTimers.delete(key);
    }
  }

  private async executeSync(userId: string, projectKey: string): Promise<void> {
    const key = this.getKey(userId, projectKey);

    // Clear timers
    this.clearTimers(key);

    // Get and clear pending updates
    const docIds = this.pendingUpdates.get(key);
    if (!docIds || docIds.size === 0) {
      return;
    }

    const docIdList = [...docIds];
    this.pendingUpdates.delete(key);

    // Clear event queue
    this.eventQueues.delete(key);

    console.log(`[TreeSync] Syncing ${docIdList.length} documents for ${key}`);

    // Process updates in batches
    const batchSize = 50;
    for (let i = 0; i < docIdList.length; i += batchSize) {
      const batch = docIdList.slice(i, i + batchSize);
      for (const docId of batch) {
        try {
          await this.updateDocumentPath(userId, projectKey, docId);
        } catch (err) {
          console.warn(`[TreeSync] Failed to update path for ${docId}:`, err);
        }
      }
    }

    console.log(`[TreeSync] Sync completed for ${key}`);
  }

  private async updateDocumentPath(
    userId: string,
    projectKey: string,
    docId: string,
  ): Promise<void> {
    try {
      // Get the current document hierarchy
      const hierarchy = await documentStore.getHierarchy(userId, projectKey, docId);

      const ancestorPath = hierarchy.slice(0, -1).map((h) => h.title);
      const docTitle = hierarchy[hierarchy.length - 1]?.title || "";

      // Preserve any in-document suffix (doc title + headings) if present.
      const rows = await query<{
        id: string;
        metadata: Record<string, unknown>;
      }>(
        `SELECT id, metadata
         FROM knowledge_index
         WHERE doc_id = $1 AND user_id = $2 AND project_key = $3`,
        [docId, userId, projectKey],
      );

      for (const row of rows.rows) {
        const metadata = (row.metadata || {}) as Record<string, unknown>;
        const existingPathRaw = metadata.path;
        const existingPath = Array.isArray(existingPathRaw)
          ? existingPathRaw.filter((v): v is string => typeof v === "string")
          : [];

        let suffix: string[] = [];
        if (docTitle) {
          const idx = existingPath.indexOf(docTitle);
          if (idx !== -1) {
            suffix = existingPath.slice(idx);
          }
        }

        const nextPath = [...ancestorPath, ...suffix];
        const nextMetadata = { ...metadata, path: nextPath };

        await query(
          `UPDATE knowledge_index
           SET metadata = $1::jsonb,
               updated_at = NOW()
           WHERE id = $2 AND user_id = $3 AND project_key = $4`,
          [JSON.stringify(nextMetadata), row.id, userId, projectKey],
        );
      }

      // Clear summary cache as content context may have changed
      await clearSummaryCache(docId);
    } catch (err) {
      // Document might have been deleted
      console.warn(`[TreeSync] Document ${docId} not found, skipping path update`);
    }
  }

  private async removeFromIndex(
    userId: string,
    projectKey: string,
    docId: string,
  ): Promise<void> {
    await query(
      `DELETE FROM knowledge_index
       WHERE doc_id = $1 AND user_id = $2 AND project_key = $3`,
      [docId, userId, projectKey],
    );
  }

  private async collectDescendants(
    userId: string,
    projectKey: string,
    parentId: string,
    maxDepth: number = 10,
    currentDepth: number = 0,
  ): Promise<string[]> {
    if (currentDepth >= maxDepth) {
      return [];
    }

    const result: string[] = [];

    try {
      const children = await documentStore.getChildren(userId, projectKey, parentId);

      for (const child of children) {
        result.push(child.id);

        // Recursively collect descendants
        const descendants = await this.collectDescendants(
          userId,
          projectKey,
          child.id,
          maxDepth,
          currentDepth + 1,
        );
        result.push(...descendants);
      }
    } catch {
      // Parent might not exist
    }

    return result;
  }
}

// ============================================================
// Singleton Export
// ============================================================

export const treeSyncManager = new TreeSyncManager();

// ============================================================
// Event Hooks for Document Store
// ============================================================

/**
 * Hook to call when a document is moved
 */
export async function notifyDocumentMoved(
  userId: string,
  projectKey: string,
  docId: string,
  oldParentId: string | null,
  newParentId: string | null,
): Promise<void> {
  await treeSyncManager.onDocumentMoved({
    userId,
    projectKey,
    docId,
    oldParentId,
    newParentId,
    timestamp: Date.now(),
  });
}

/**
 * Hook to call when a document is deleted
 */
export async function notifyDocumentDeleted(
  userId: string,
  projectKey: string,
  docId: string,
): Promise<void> {
  await treeSyncManager.onDocumentDeleted({
    userId,
    projectKey,
    docId,
    timestamp: Date.now(),
  });
}

/**
 * Hook to call when a document is updated
 */
export function notifyDocumentUpdated(
  userId: string,
  projectKey: string,
  docId: string,
): void {
  treeSyncManager.onDocumentUpdated({
    userId,
    projectKey,
    docId,
    timestamp: Date.now(),
  });
}

/**
 * Force sync for a project (useful after batch operations)
 */
export async function forceSyncProject(
  userId: string,
  projectKey: string,
): Promise<void> {
  await treeSyncManager.forceSync(userId, projectKey);
}
