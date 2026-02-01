/**
 * Block Diff Module
 *
 * A block-level document diff library for Tiptap documents.
 * Uses block IDs as anchors (similar to line numbers in text diff).
 *
 * @example
 * ```typescript
 * import { blockDiff, toUnifiedDiff, toSideBySide } from '@zeus/shared/block-diff';
 *
 * const result = blockDiff(originalDoc, editedDoc);
 *
 * // Get unified format (linear list)
 * const unified = toUnifiedDiff(result);
 *
 * // Get side-by-side format (aligned columns)
 * const sideBySide = toSideBySide(result);
 * ```
 */

// Types
export type {
  RawBlock,
  NormalizedBlock,
  BlockDiffStatus,
  BlockDiffEntry,
  BlockDiffOptions,
  BlockDiffResult,
  FieldChange,
  UnifiedDiffOutput,
  SideBySideOutput,
  SideBySideRow,
  LCSMatch,
} from "./types";

// Main diff functions
export {
  blockDiff,
  hasChanges,
  getChangedBlocks,
  countChanges,
} from "./diff";

// Normalization utilities
export {
  normalizeBlock,
  extractTopLevelBlocks,
  deepStripNulls,
  isPureEmptyBlock,
  stableStringify,
  blockContentKey,
} from "./normalize";

// Comparison utilities
export {
  blocksEqual,
  computeFieldChanges,
  summarizeChanges,
  isContentChange,
  isAttrChange,
  isTypeChange,
} from "./compare";

// Output formatters
export {
  toUnifiedDiff,
  toSideBySide,
  getStatusLabel,
  getStatusColor,
  formatEntry,
  generateSummary,
  filterByStatus,
  groupByBlockType,
  wrapBlockInDoc,
  wrapBlocksInDoc,
} from "./format";

// LCS internals (for advanced use)
export {
  buildLCSTable,
  backtrackLCS,
  generateDiffPath,
  computeLCSDiff,
} from "./lcs";
export type { DiffPathEntry } from "./lcs";
