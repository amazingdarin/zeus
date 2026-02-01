/**
 * Block Content Comparison
 *
 * Utilities for comparing block content and detecting field-level changes.
 */

import type { NormalizedBlock, FieldChange } from "./types";
import { blockContentKey, deepStripNulls } from "./normalize";

/**
 * Check if two normalized blocks have equal content (ignoring id).
 */
export function blocksEqual(
  left: NormalizedBlock,
  right: NormalizedBlock
): boolean {
  return blockContentKey(left) === blockContentKey(right);
}

/**
 * Get the type of a value for comparison purposes.
 */
function getValueType(
  value: unknown
): "null" | "array" | "object" | "primitive" {
  if (value === null || value === undefined) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  if (typeof value === "object") {
    return "object";
  }
  return "primitive";
}

/**
 * Compute field-level changes between two blocks.
 * Returns an array of changes with their paths.
 *
 * @param original - Original block
 * @param edited - Edited block
 * @returns Array of field changes
 */
export function computeFieldChanges(
  original: NormalizedBlock,
  edited: NormalizedBlock
): FieldChange[] {
  const changes: FieldChange[] = [];
  const seen = new Set<string>();

  // Prepare comparable objects (strip nulls)
  const left = deepStripNulls({
    type: original.type,
    attrs: original.attrs,
    content: original.content,
    text: original.text,
    marks: original.marks,
  });

  const right = deepStripNulls({
    type: edited.type,
    attrs: edited.attrs,
    content: edited.content,
    text: edited.text,
    marks: edited.marks,
  });

  /**
   * Recursively walk and compare values
   */
  function walk(
    leftVal: unknown,
    rightVal: unknown,
    path: string
  ): void {
    // Skip if values are strictly equal
    if (leftVal === rightVal) {
      return;
    }

    const leftType = getValueType(leftVal);
    const rightType = getValueType(rightVal);

    // Type mismatch is a change
    if (leftType !== rightType) {
      addChange(path, leftVal, rightVal);
      return;
    }

    // Both null/undefined - no change
    if (leftType === "null") {
      return;
    }

    // Compare arrays element by element
    if (leftType === "array") {
      const leftArr = leftVal as unknown[];
      const rightArr = rightVal as unknown[];
      const maxLen = Math.max(leftArr.length, rightArr.length);

      for (let i = 0; i < maxLen; i++) {
        walk(leftArr[i], rightArr[i], `${path}[${i}]`);
      }
      return;
    }

    // Compare objects key by key
    if (leftType === "object") {
      const leftObj = leftVal as Record<string, unknown>;
      const rightObj = rightVal as Record<string, unknown>;
      const allKeys = new Set([
        ...Object.keys(leftObj),
        ...Object.keys(rightObj),
      ]);

      for (const key of allKeys) {
        const nextPath = path ? `${path}.${key}` : key;
        walk(leftObj[key], rightObj[key], nextPath);
      }
      return;
    }

    // Primitive values that aren't equal
    addChange(path, leftVal, rightVal);
  }

  function addChange(path: string, before: unknown, after: unknown): void {
    // Deduplicate
    const key = `${path}::${JSON.stringify(before)}::${JSON.stringify(after)}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    changes.push({ path, before, after });
  }

  walk(left, right, "");

  return changes;
}

/**
 * Get a human-readable summary of changes.
 */
export function summarizeChanges(changes: FieldChange[]): string {
  if (changes.length === 0) {
    return "No changes";
  }

  const pathGroups: Record<string, FieldChange[]> = {};
  for (const change of changes) {
    const root = change.path.split(/[.\[]/)[0] || "root";
    if (!pathGroups[root]) {
      pathGroups[root] = [];
    }
    pathGroups[root].push(change);
  }

  const parts: string[] = [];
  for (const [root, groupChanges] of Object.entries(pathGroups)) {
    if (groupChanges.length === 1) {
      parts.push(`${root} changed`);
    } else {
      parts.push(`${root} (${groupChanges.length} changes)`);
    }
  }

  return parts.join(", ");
}

/**
 * Check if a change affects the content (text) vs just attributes.
 */
export function isContentChange(change: FieldChange): boolean {
  return (
    change.path.startsWith("content") ||
    change.path.startsWith("text") ||
    change.path.startsWith("marks")
  );
}

/**
 * Check if a change affects attributes.
 */
export function isAttrChange(change: FieldChange): boolean {
  return change.path.startsWith("attrs");
}

/**
 * Check if a change affects the block type.
 */
export function isTypeChange(change: FieldChange): boolean {
  return change.path === "type";
}
