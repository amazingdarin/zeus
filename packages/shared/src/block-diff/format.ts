/**
 * Block Diff Output Formatters
 *
 * Provides different output formats for block diff results:
 * - Unified: Linear list of changes (similar to unified diff)
 * - Side-by-side: Two aligned columns for comparison
 */

import type {
  BlockDiffResult,
  BlockDiffEntry,
  UnifiedDiffOutput,
  SideBySideOutput,
  SideBySideRow,
  NormalizedBlock,
} from "./types";

/**
 * Convert diff result to unified format.
 * Returns a linear list of all changes in document order.
 */
export function toUnifiedDiff(result: BlockDiffResult): UnifiedDiffOutput {
  return {
    changes: result.entries,
    stats: result.stats,
  };
}

/**
 * Convert diff result to side-by-side format.
 * Returns aligned rows for easy visual comparison.
 */
export function toSideBySide(result: BlockDiffResult): SideBySideOutput {
  const rows: SideBySideRow[] = [];

  for (const entry of result.entries) {
    rows.push({
      status: entry.status,
      left: entry.original,
      right: entry.edited,
      fieldChanges: entry.fieldChanges,
    });
  }

  return {
    rows,
    stats: result.stats,
  };
}

/**
 * Format entry for display with optional context.
 */
export interface FormattedDiffEntry {
  /** Status badge text */
  statusLabel: string;
  /** Status color hint */
  statusColor: "green" | "red" | "yellow" | "gray";
  /** Block ID for reference */
  blockId: string | null;
  /** Block type */
  blockType: string;
  /** Summary of changes (for modified) */
  changeSummary?: string;
  /** Original block */
  original: NormalizedBlock | null;
  /** Edited block */
  edited: NormalizedBlock | null;
}

/**
 * Get status label for display
 */
export function getStatusLabel(status: BlockDiffEntry["status"]): string {
  switch (status) {
    case "added":
      return "Added";
    case "removed":
      return "Removed";
    case "modified":
      return "Modified";
    case "unchanged":
      return "Unchanged";
    default:
      return "Unknown";
  }
}

/**
 * Get status color hint for styling
 */
export function getStatusColor(
  status: BlockDiffEntry["status"]
): FormattedDiffEntry["statusColor"] {
  switch (status) {
    case "added":
      return "green";
    case "removed":
      return "red";
    case "modified":
      return "yellow";
    case "unchanged":
      return "gray";
    default:
      return "gray";
  }
}

/**
 * Format a diff entry for display.
 */
export function formatEntry(entry: BlockDiffEntry): FormattedDiffEntry {
  const formatted: FormattedDiffEntry = {
    statusLabel: getStatusLabel(entry.status),
    statusColor: getStatusColor(entry.status),
    blockId: entry.blockId,
    blockType: entry.blockType,
    original: entry.original,
    edited: entry.edited,
  };

  if (entry.status === "modified" && entry.fieldChanges) {
    const paths = entry.fieldChanges.map((c) => c.path.split(/[.\[]/)[0]);
    const uniquePaths = [...new Set(paths)];
    formatted.changeSummary = uniquePaths.join(", ");
  }

  return formatted;
}

/**
 * Generate a text summary of the diff.
 */
export function generateSummary(result: BlockDiffResult): string {
  const { stats } = result;
  const parts: string[] = [];

  if (stats.added > 0) {
    parts.push(`+${stats.added} added`);
  }
  if (stats.removed > 0) {
    parts.push(`-${stats.removed} removed`);
  }
  if (stats.modified > 0) {
    parts.push(`~${stats.modified} modified`);
  }
  if (stats.unchanged > 0) {
    parts.push(`${stats.unchanged} unchanged`);
  }

  if (parts.length === 0) {
    return "No changes";
  }

  return parts.join(", ");
}

/**
 * Filter entries by status.
 */
export function filterByStatus(
  entries: BlockDiffEntry[],
  statuses: BlockDiffEntry["status"][]
): BlockDiffEntry[] {
  const statusSet = new Set(statuses);
  return entries.filter((e) => statusSet.has(e.status));
}

/**
 * Group entries by their block type.
 */
export function groupByBlockType(
  entries: BlockDiffEntry[]
): Record<string, BlockDiffEntry[]> {
  const groups: Record<string, BlockDiffEntry[]> = {};

  for (const entry of entries) {
    const type = entry.blockType;
    if (!groups[type]) {
      groups[type] = [];
    }
    groups[type].push(entry);
  }

  return groups;
}

/**
 * Wrap a single block in a doc structure (for rendering).
 * Falls back to reconstructing from normalized data if raw is not available.
 */
export function wrapBlockInDoc(
  block: NormalizedBlock | null
): { type: string; content: unknown[] } | null {
  if (!block) {
    return null;
  }

  // Prefer raw block if available
  if (block.raw) {
    return {
      type: "doc",
      content: [block.raw],
    };
  }

  // Reconstruct block from normalized data
  const reconstructed: Record<string, unknown> = {
    type: block.type,
  };

  // Add attrs if non-empty
  const attrs: Record<string, unknown> = { ...block.attrs };
  if (block.id) {
    attrs.id = block.id;
  }
  if (Object.keys(attrs).length > 0) {
    reconstructed.attrs = attrs;
  }

  // Add content if non-empty
  if (block.content && block.content.length > 0) {
    reconstructed.content = block.content;
  }

  // Add text if present
  if (block.text !== undefined) {
    reconstructed.text = block.text;
  }

  // Add marks if present
  if (block.marks && block.marks.length > 0) {
    reconstructed.marks = block.marks;
  }

  return {
    type: "doc",
    content: [reconstructed],
  };
}

/**
 * Wrap multiple blocks in a doc structure (for rendering).
 */
export function wrapBlocksInDoc(
  blocks: NormalizedBlock[]
): { type: string; content: unknown[] } {
  return {
    type: "doc",
    content: blocks.map((b) => b.raw).filter(Boolean),
  };
}
