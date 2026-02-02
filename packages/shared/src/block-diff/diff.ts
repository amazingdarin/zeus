/**
 * Block Diff - Main Module
 *
 * Provides the primary blockDiff function that computes
 * differences between two documents at the block level.
 */

import type {
  RawBlock,
  NormalizedBlock,
  BlockDiffEntry,
  BlockDiffOptions,
  BlockDiffResult,
  BlockDiffStatus,
} from "./types";
import {
  normalizeBlock,
  extractTopLevelBlocks,
  isPureEmptyBlock,
} from "./normalize";
import { computeLCSDiff } from "./lcs";
import { blocksEqual, computeFieldChanges } from "./compare";

/**
 * Default options for block diff
 */
const DEFAULT_OPTIONS: Required<BlockDiffOptions> = {
  computeFieldChanges: true,
  includeUnchanged: true,
  mergeConsecutive: false,
};

/**
 * Compute a block-level diff between two documents.
 *
 * @param original - Original document (Tiptap JSONContent)
 * @param edited - Edited document (Tiptap JSONContent)
 * @param options - Diff options
 * @returns BlockDiffResult with entries and statistics
 */
export function blockDiff(
  original: RawBlock | null | undefined,
  edited: RawBlock | null | undefined,
  options?: BlockDiffOptions
): BlockDiffResult {
  console.log(`[blockDiff] starting...`);
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Extract and normalize blocks
  console.log(`[blockDiff] extracting blocks...`);
  const originalBlocks = extractTopLevelBlocks(original);
  const editedBlocks = extractTopLevelBlocks(edited);
  console.log(`[blockDiff] extracted: original=${originalBlocks.length}, edited=${editedBlocks.length}`);

  console.log(`[blockDiff] normalizing blocks...`);
  const normalizedOriginal = originalBlocks.map(normalizeBlock);
  const normalizedEdited = editedBlocks.map(normalizeBlock);
  console.log(`[blockDiff] normalized done`);

  // Compute LCS-based diff path
  console.log(`[blockDiff] computing LCS diff...`);
  const diffPath = computeLCSDiff(normalizedOriginal, normalizedEdited);
  console.log(`[blockDiff] LCS diff done, path length=${diffPath.length}`);

  // Build diff entries
  const entries: BlockDiffEntry[] = [];
  const stats = {
    added: 0,
    removed: 0,
    modified: 0,
    unchanged: 0,
    total: 0,
  };

  for (const pathEntry of diffPath) {
    let entry: BlockDiffEntry | null = null;

    if (pathEntry.type === "match") {
      // Matched by ID - check if content changed
      const origBlock = pathEntry.originalIndex != null 
        ? normalizedOriginal[pathEntry.originalIndex] 
        : null;
      const editBlock = pathEntry.editedIndex != null 
        ? normalizedEdited[pathEntry.editedIndex] 
        : null;

      // Skip if either block is missing
      if (!origBlock || !editBlock) {
        continue;
      }

      if (blocksEqual(origBlock, editBlock)) {
        // Unchanged
        if (opts.includeUnchanged) {
          entry = createEntry("unchanged", origBlock, editBlock, opts);
          stats.unchanged++;
        }
      } else {
        // Modified (same ID, different content)
        entry = createEntry("modified", origBlock, editBlock, opts);
        stats.modified++;
      }
    } else if (pathEntry.type === "added") {
      // Added block
      const editBlock = pathEntry.editedIndex != null 
        ? normalizedEdited[pathEntry.editedIndex] 
        : null;

      // Skip pure empty blocks or missing blocks
      if (editBlock && !isPureEmptyBlock(editBlock)) {
        entry = createEntry("added", null, editBlock, opts);
        stats.added++;
      }
    } else if (pathEntry.type === "removed") {
      // Removed block
      const origBlock = pathEntry.originalIndex != null 
        ? normalizedOriginal[pathEntry.originalIndex] 
        : null;

      // Skip pure empty blocks or missing blocks
      if (origBlock && !isPureEmptyBlock(origBlock)) {
        entry = createEntry("removed", origBlock, null, opts);
        stats.removed++;
      }
    }

    if (entry) {
      if (opts.mergeConsecutive && entries.length > 0) {
        const last = entries[entries.length - 1];
        if (last.status === entry.status && canMerge(last, entry)) {
          mergeEntries(last, entry);
          continue;
        }
      }
      entries.push(entry);
    }
  }

  stats.total = stats.added + stats.removed + stats.modified + stats.unchanged;

  return { entries, stats };
}

/**
 * Create a diff entry
 */
function createEntry(
  status: BlockDiffStatus,
  original: NormalizedBlock | null,
  edited: NormalizedBlock | null,
  opts: Required<BlockDiffOptions>
): BlockDiffEntry {
  const entry: BlockDiffEntry = {
    status,
    blockId: edited?.id ?? original?.id ?? null,
    blockType: edited?.type ?? original?.type ?? "unknown",
    original,
    edited,
  };

  // Compute field changes for modified blocks
  if (status === "modified" && opts.computeFieldChanges && original && edited) {
    entry.fieldChanges = computeFieldChanges(original, edited);
  }

  return entry;
}

/**
 * Check if two entries can be merged (for consecutive merging)
 */
function canMerge(
  _a: BlockDiffEntry,
  _b: BlockDiffEntry
): boolean {
  // For now, don't merge - keep blocks separate
  // Future: could merge consecutive text paragraphs
  return false;
}

/**
 * Merge entry b into entry a
 */
function mergeEntries(
  _a: BlockDiffEntry,
  _b: BlockDiffEntry
): void {
  // Placeholder for merge logic
  // Would combine content arrays, etc.
}

/**
 * Quick check if two documents have any differences.
 * More efficient than full diff when you only need to know if changed.
 */
export function hasChanges(
  original: RawBlock | null | undefined,
  edited: RawBlock | null | undefined
): boolean {
  const result = blockDiff(original, edited, {
    computeFieldChanges: false,
    includeUnchanged: false,
    mergeConsecutive: false,
  });

  return result.entries.length > 0;
}

/**
 * Get only the changed blocks (added, removed, modified).
 */
export function getChangedBlocks(
  original: RawBlock | null | undefined,
  edited: RawBlock | null | undefined,
  options?: Omit<BlockDiffOptions, "includeUnchanged">
): BlockDiffEntry[] {
  const result = blockDiff(original, edited, {
    ...options,
    includeUnchanged: false,
  });
  return result.entries;
}

/**
 * Count the number of changes by type.
 */
export function countChanges(
  original: RawBlock | null | undefined,
  edited: RawBlock | null | undefined
): BlockDiffResult["stats"] {
  return blockDiff(original, edited, {
    computeFieldChanges: false,
    includeUnchanged: false,
  }).stats;
}
