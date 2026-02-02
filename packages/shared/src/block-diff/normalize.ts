/**
 * Block Normalization
 *
 * Utilities for normalizing blocks and stripping null/undefined values.
 */

import type { RawBlock, NormalizedBlock } from "./types";
import { createMarkdownFingerprint } from "./block-markdown";

/**
 * Check if a value is considered "empty" for comparison purposes.
 * Empty values: null, undefined, empty string
 * 
 * Note: 0 is NOT considered empty because it may be a meaningful value
 * (e.g., size: 0 means zero-byte file, which is different from size: undefined)
 */
function isEmptyValue(value: unknown, stripEmptyStrings = false): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  if (stripEmptyStrings && value === "") {
    return true;
  }
  return false;
}

/**
 * Recursively strips null and undefined values from an object or array.
 * Empty objects/arrays after stripping are preserved.
 * 
 * @param value - The value to strip
 * @param stripEmptyStrings - If true, also strips empty string values
 */
export function deepStripNulls<T>(value: T, stripEmptyStrings = false): T {
  if (isEmptyValue(value, stripEmptyStrings)) {
    return undefined as T;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => deepStripNulls(item, stripEmptyStrings))
      .filter((item) => item !== undefined) as T;
  }

  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      const stripped = deepStripNulls(val, stripEmptyStrings);
      if (stripped !== undefined) {
        result[key] = stripped;
      }
    }
    return result as T;
  }

  return value;
}

/**
 * Omit specified keys from an object
 */
export function omit<T extends Record<string, unknown>>(
  obj: T,
  keys: string[]
): Omit<T, (typeof keys)[number]> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (!keys.includes(key)) {
      result[key] = val;
    }
  }
  return result as Omit<T, (typeof keys)[number]>;
}

/**
 * Normalize a raw block into a consistent structure.
 * - Strips all null/undefined values
 * - Extracts id from attrs
 * - Preserves original raw block for reference
 */
export function normalizeBlock(block: RawBlock): NormalizedBlock {
  const cleaned = deepStripNulls(block) as RawBlock;

  const id = (cleaned.attrs?.id as string) ?? null;
  const type = cleaned.type ?? "unknown";

  // Remove id from attrs for comparison purposes
  const attrs = cleaned.attrs ? omit(cleaned.attrs, ["id"]) : {};

  return {
    id,
    type,
    attrs,
    content: (cleaned.content ?? []) as unknown[],
    text: cleaned.text,
    marks: cleaned.marks as unknown[] | undefined,
    raw: block,
  };
}

/**
 * Extract top-level blocks from a document.
 * Only extracts direct children of doc.content.
 */
export function extractTopLevelBlocks(
  doc: RawBlock | null | undefined
): RawBlock[] {
  if (!doc || !Array.isArray(doc.content)) {
    return [];
  }
  return doc.content.filter(
    (block): block is RawBlock => block !== null && typeof block === "object"
  );
}

/**
 * Check if a block is "pure empty" - an empty paragraph with no meaningful content.
 * Used to filter out trivial empty blocks from diff.
 */
export function isPureEmptyBlock(block: NormalizedBlock | null | undefined): boolean {
  // Handle null/undefined blocks
  if (!block) {
    return true; // Treat missing blocks as empty
  }
  
  // Only paragraphs can be considered "pure empty"
  if (block.type !== "paragraph") {
    return false;
  }

  // Has content - not empty
  if (block.content && block.content.length > 0) {
    return false;
  }

  // Has meaningful attributes (other than those that don't affect content)
  const meaningfulAttrs = Object.keys(block.attrs).filter(
    (key) => block.attrs[key] !== null && block.attrs[key] !== undefined
  );
  if (meaningfulAttrs.length > 0) {
    return false;
  }

  return true;
}

/**
 * Create a stable string representation of a normalized block for comparison.
 * Keys are sorted to ensure consistent ordering.
 */
export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value === "object") {
    if (Array.isArray(value)) {
      return "[" + value.map(stableStringify).join(",") + "]";
    }

    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const pairs = keys.map(
      (key) => JSON.stringify(key) + ":" + stableStringify(obj[key])
    );
    return "{" + pairs.join(",") + "}";
  }

  return JSON.stringify(value);
}

/**
 * Create a comparison key for a normalized block (excluding id).
 * Used to determine if two blocks with the same id have different content.
 * 
 * Uses Markdown representation as canonical form for comparison.
 * This ensures content-equivalent blocks are considered equal even if
 * their JSON structure differs (e.g., different attribute order, empty strings).
 */
export function blockContentKey(block: NormalizedBlock): string {
  return createMarkdownFingerprint(block);
}
