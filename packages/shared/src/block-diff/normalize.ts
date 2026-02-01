/**
 * Block Normalization
 *
 * Utilities for normalizing blocks and stripping null/undefined values.
 */

import type { RawBlock, NormalizedBlock } from "./types";

/**
 * Recursively strips null and undefined values from an object or array.
 * Empty objects/arrays after stripping are preserved.
 */
export function deepStripNulls<T>(value: T): T {
  if (value === null || value === undefined) {
    return undefined as T;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => deepStripNulls(item))
      .filter((item) => item !== undefined) as T;
  }

  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      const stripped = deepStripNulls(val);
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
export function isPureEmptyBlock(block: NormalizedBlock): boolean {
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
 */
export function blockContentKey(block: NormalizedBlock): string {
  const forComparison = {
    type: block.type,
    attrs: block.attrs,
    content: block.content,
    text: block.text,
    marks: block.marks,
  };
  return stableStringify(deepStripNulls(forComparison));
}
