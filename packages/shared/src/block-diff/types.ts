/**
 * Block Diff Types
 *
 * Type definitions for block-level document diffing.
 * Block IDs serve as anchors (similar to line numbers in text diff).
 */

/**
 * Raw block content from Tiptap JSONContent
 */
export interface RawBlock {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: RawBlock[];
  text?: string;
  marks?: Array<{
    type: string;
    attrs?: Record<string, unknown>;
  }>;
}

/**
 * Normalized block with null values stripped and consistent structure
 */
export interface NormalizedBlock {
  /** Block ID from attrs.id, null if not present */
  id: string | null;
  /** Block type (paragraph, heading, etc.) */
  type: string;
  /** Attributes excluding id, with null values removed */
  attrs: Record<string, unknown>;
  /** Child content with null values removed */
  content: unknown[];
  /** Text content for text nodes */
  text?: string;
  /** Marks (formatting) for text nodes */
  marks?: unknown[];
  /** Original raw block for reference */
  raw?: RawBlock;
}

/**
 * Diff status for a block
 */
export type BlockDiffStatus = "added" | "removed" | "modified" | "unchanged";

/**
 * Field-level change within a modified block
 */
export interface FieldChange {
  /** JSON path to the changed field (e.g., "attrs.level", "content[0].text") */
  path: string;
  /** Value before change */
  before: unknown;
  /** Value after change */
  after: unknown;
}

/**
 * Single entry in the diff result
 */
export interface BlockDiffEntry {
  /** Change status */
  status: BlockDiffStatus;
  /** Block ID (from original for removed/modified, from edited for added) */
  blockId: string | null;
  /** Block type */
  blockType: string;
  /** Original block (null for added) */
  original: NormalizedBlock | null;
  /** Edited block (null for removed) */
  edited: NormalizedBlock | null;
  /** Field-level changes (only for modified status) */
  fieldChanges?: FieldChange[];
}

/**
 * Options for block diff
 */
export interface BlockDiffOptions {
  /** Whether to compute field-level changes for modified blocks (default: true) */
  computeFieldChanges?: boolean;
  /** Whether to include unchanged blocks in result (default: true) */
  includeUnchanged?: boolean;
  /** Whether to merge consecutive blocks with same status (default: false) */
  mergeConsecutive?: boolean;
}

/**
 * Result of block diff operation
 */
export interface BlockDiffResult {
  /** List of diff entries */
  entries: BlockDiffEntry[];
  /** Summary statistics */
  stats: {
    added: number;
    removed: number;
    modified: number;
    unchanged: number;
    total: number;
  };
}

/**
 * Unified diff output format - list of changes
 */
export interface UnifiedDiffOutput {
  /** All diff entries in document order */
  changes: BlockDiffEntry[];
  /** Summary statistics */
  stats: BlockDiffResult["stats"];
}

/**
 * Side-by-side row for aligned display
 */
export interface SideBySideRow {
  /** Row status */
  status: BlockDiffStatus;
  /** Left side (original) block, null if added */
  left: NormalizedBlock | null;
  /** Right side (edited) block, null if removed */
  right: NormalizedBlock | null;
  /** Field changes for modified rows */
  fieldChanges?: FieldChange[];
}

/**
 * Side-by-side diff output format - two aligned columns
 */
export interface SideBySideOutput {
  /** Aligned rows */
  rows: SideBySideRow[];
  /** Summary statistics */
  stats: BlockDiffResult["stats"];
}

/**
 * LCS matching result for internal use
 */
export interface LCSMatch {
  /** Index in original array */
  originalIndex: number;
  /** Index in edited array */
  editedIndex: number;
}
