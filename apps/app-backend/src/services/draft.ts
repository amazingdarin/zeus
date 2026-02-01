/**
 * Draft Service
 *
 * Manages document drafts for AI-generated content pending user confirmation.
 */

import { v4 as uuidv4 } from "uuid";
import type { JSONContent } from "@tiptap/core";
import type { CreateDraftInput, DocumentDraft } from "../llm/skills/types.js";
import { documentStore } from "../storage/document-store.js";

// In-memory draft storage
const drafts = new Map<string, DocumentDraft>();

// Draft TTL: 1 hour
const DRAFT_TTL = 60 * 60 * 1000;

// Cleanup interval: every 10 minutes
const CLEANUP_INTERVAL = 10 * 60 * 1000;

/**
 * Start periodic cleanup of expired drafts
 */
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function startCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, draft] of drafts) {
      if (draft.expiresAt < now) {
        drafts.delete(id);
      }
    }
  }, CLEANUP_INTERVAL);
}

function stopCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

// Start cleanup on module load
startCleanup();

/**
 * Draft service
 */
export const draftService = {
  /**
   * Create a new draft
   */
  create(input: CreateDraftInput): DocumentDraft {
    const now = Date.now();
    const draft: DocumentDraft = {
      id: uuidv4(),
      projectKey: input.projectKey,
      docId: input.docId ?? null,
      parentId: input.parentId ?? null,
      title: input.title,
      originalContent: input.originalContent ?? null,
      proposedContent: input.proposedContent,
      status: "pending",
      createdAt: now,
      expiresAt: now + DRAFT_TTL,
    };

    drafts.set(draft.id, draft);
    return draft;
  },

  /**
   * Get a draft by ID
   */
  get(draftId: string): DocumentDraft | null {
    const draft = drafts.get(draftId);
    if (!draft) return null;

    // Check expiration
    if (draft.expiresAt < Date.now()) {
      drafts.delete(draftId);
      return null;
    }

    return draft;
  },

  /**
   * Apply a draft (save to document store)
   * @param modifiedContent - Optional modified content (if user made changes in DIFF view)
   */
  async apply(
    projectKey: string,
    draftId: string,
    modifiedContent?: JSONContent,
  ): Promise<{ docId: string; isNew: boolean }> {
    const draft = this.get(draftId);
    if (!draft) {
      throw new Error("Draft not found or expired");
    }

    if (draft.projectKey !== projectKey) {
      throw new Error("Draft does not belong to this project");
    }

    if (draft.status !== "pending") {
      throw new Error(`Draft is already ${draft.status}`);
    }

    const contentToSave = modifiedContent ?? draft.proposedContent;

    try {
      let docId: string;
      let isNew = false;

      if (draft.docId) {
        // Update existing document
        await documentStore.update(projectKey, draft.docId, {
          title: draft.title,
          body: contentToSave,
        });
        docId = draft.docId;
      } else {
        // Create new document
        const newDoc = await documentStore.create(projectKey, {
          title: draft.title,
          slug: generateSlug(draft.title),
          parent_id: draft.parentId || undefined,
          body: contentToSave,
        });
        docId = newDoc.meta.id;
        isNew = true;
      }

      // Mark draft as applied
      draft.status = "applied";

      return { docId, isNew };
    } catch (error) {
      throw new Error(
        `Failed to apply draft: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },

  /**
   * Reject a draft
   */
  reject(draftId: string): void {
    const draft = drafts.get(draftId);
    if (draft) {
      draft.status = "rejected";
    }
  },

  /**
   * Delete a draft
   */
  delete(draftId: string): boolean {
    return drafts.delete(draftId);
  },

  /**
   * List all pending drafts for a project
   */
  listPending(projectKey: string): DocumentDraft[] {
    const now = Date.now();
    const result: DocumentDraft[] = [];

    for (const draft of drafts.values()) {
      if (
        draft.projectKey === projectKey &&
        draft.status === "pending" &&
        draft.expiresAt > now
      ) {
        result.push(draft);
      }
    }

    return result;
  },

  /**
   * Clear all drafts (for testing)
   */
  clearAll(): void {
    drafts.clear();
  },

  /**
   * Stop cleanup timer (for graceful shutdown)
   */
  shutdown(): void {
    stopCleanup();
  },
};

/**
 * Generate URL-safe slug from title
 */
function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}
