/**
 * LCS (Longest Common Subsequence) Algorithm
 *
 * Implements LCS matching for blocks based on their IDs.
 * Similar to how text diff uses line content, we use block IDs as anchors.
 */

import type { NormalizedBlock, LCSMatch } from "./types";
import { createMarkdownFingerprint } from "./block-markdown";

/**
 * Create a content fingerprint for matching.
 * Uses Markdown representation as canonical form for comparison.
 * This ensures content-equivalent blocks match even if their JSON structure differs.
 */
function createContentFingerprint(block: NormalizedBlock): string {
  return createMarkdownFingerprint(block);
}

/**
 * Pre-compute content keys for all blocks.
 * This avoids expensive re-computation in the O(n*m) loop.
 * Keys are computed for all blocks to handle cases where one has ID and other doesn't.
 */
function precomputeContentKeys(blocks: NormalizedBlock[]): Map<number, string> {
  const keys = new Map<number, string>();
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    // Compute fingerprint for all blocks (not just those without IDs)
    keys.set(i, createContentFingerprint(block));
  }
  return keys;
}

/**
 * Build LCS table using dynamic programming.
 * Matches blocks by their ID only.
 *
 * @param original - Array of original blocks
 * @param edited - Array of edited blocks
 * @returns 2D DP table where dp[i][j] = length of LCS for original[0..i-1] and edited[0..j-1]
 */
export function buildLCSTable(
  original: NormalizedBlock[],
  edited: NormalizedBlock[]
): number[][] {
  const m = original.length;
  const n = edited.length;

  console.log(`[LCS] buildLCSTable: original=${m}, edited=${n}`);

  // Pre-compute content keys for blocks without IDs
  const originalKeys = precomputeContentKeys(original);
  const editedKeys = precomputeContentKeys(edited);

  console.log(`[LCS] precomputed keys done`);

  // Initialize DP table with zeros
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0)
  );

  console.log(`[LCS] DP table initialized, starting fill...`);

  // Fill the table
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const origBlock = original[i - 1];
      const editBlock = edited[j - 1];
      const origKey = originalKeys.get(i - 1);
      const editKey = editedKeys.get(j - 1);

      // Use blocksMatchSimple for consistent matching
      const isMatch = blocksMatchSimple(origBlock, editBlock, origKey, editKey);

      if (isMatch) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  console.log(`[LCS] DP table fill complete`);

  return dp;
}

/**
 * Check if blocks match (for backtracking).
 * This is a simpler version that uses pre-computed keys.
 * 
 * Matching priority:
 * 1. If both have same ID -> match
 * 2. If types differ -> no match
 * 3. If content fingerprints match -> match (even if IDs differ)
 */
function blocksMatchSimple(
  a: NormalizedBlock,
  b: NormalizedBlock,
  aKey: string | undefined,
  bKey: string | undefined
): boolean {
  // If both have IDs and they match, it's a match
  if (a.id && b.id && a.id === b.id) {
    return true;
  }
  
  // If types don't match, they can't be the same block
  if (a.type !== b.type) {
    return false;
  }
  
  // Fall back to content fingerprint matching
  // This handles:
  // - Blocks where at least one doesn't have an ID
  // - Blocks with different IDs but identical content (e.g., AI-regenerated content)
  if (aKey !== undefined && bKey !== undefined) {
    return aKey === bKey;
  }
  
  return false;
}

/**
 * Backtrack through LCS table to find matched pairs.
 *
 * @param dp - LCS table from buildLCSTable
 * @param original - Array of original blocks
 * @param edited - Array of edited blocks
 * @returns Array of matched index pairs
 */
export function backtrackLCS(
  dp: number[][],
  original: NormalizedBlock[],
  edited: NormalizedBlock[]
): LCSMatch[] {
  console.log(`[LCS] backtrackLCS starting...`);
  
  // Pre-compute content keys for blocks without IDs
  const originalKeys = precomputeContentKeys(original);
  const editedKeys = precomputeContentKeys(edited);

  const matches: LCSMatch[] = [];
  let i = original.length;
  let j = edited.length;
  let iterations = 0;
  const maxIterations = (original.length + edited.length) * 2;

  while (i > 0 && j > 0) {
    iterations++;
    if (iterations > maxIterations) {
      console.error(`[LCS] backtrackLCS exceeded max iterations! i=${i}, j=${j}`);
      break;
    }

    const origBlock = original[i - 1];
    const editBlock = edited[j - 1];
    const origKey = originalKeys.get(i - 1);
    const editKey = editedKeys.get(j - 1);

    if (blocksMatchSimple(origBlock, editBlock, origKey, editKey)) {
      // This is a match
      matches.unshift({
        originalIndex: i - 1,
        editedIndex: j - 1,
      });
      i--;
      j--;
    } else if (dp[i][j - 1] >= dp[i - 1][j]) {
      // Move left (edited block was added)
      j--;
    } else {
      // Move up (original block was removed)
      i--;
    }
  }

  console.log(`[LCS] backtrackLCS done, iterations=${iterations}, matches=${matches.length}`);
  return matches;
}

/**
 * Diff path entry for internal processing
 */
export interface DiffPathEntry {
  type: "match" | "added" | "removed";
  originalIndex: number | null;
  editedIndex: number | null;
}

/**
 * Generate the full diff path from LCS matches.
 * This produces a sequence of operations (match, added, removed)
 * that transforms original into edited.
 *
 * @param matches - LCS matches from backtrackLCS
 * @param originalLength - Length of original array
 * @param editedLength - Length of edited array
 * @returns Array of diff path entries in order
 */
export function generateDiffPath(
  matches: LCSMatch[],
  originalLength: number,
  editedLength: number
): DiffPathEntry[] {
  console.log(`[LCS] generateDiffPath: originalLen=${originalLength}, editedLen=${editedLength}, matches=${matches.length}`);
  
  const path: DiffPathEntry[] = [];
  let oi = 0; // original index
  let ei = 0; // edited index
  let mi = 0; // match index

  while (oi < originalLength || ei < editedLength) {
    // If we've exhausted original, add remaining edited as "added"
    if (oi >= originalLength) {
      path.push({
        type: "added",
        originalIndex: null,
        editedIndex: ei,
      });
      ei++;
      continue;
    }

    // If we've exhausted edited, add remaining original as "removed"
    if (ei >= editedLength) {
      path.push({
        type: "removed",
        originalIndex: oi,
        editedIndex: null,
      });
      oi++;
      continue;
    }

    const match = mi < matches.length ? matches[mi] : null;

    if (match && oi === match.originalIndex && ei === match.editedIndex) {
      // Both indices align with a match
      path.push({
        type: "match",
        originalIndex: oi,
        editedIndex: ei,
      });
      oi++;
      ei++;
      mi++;
    } else if (match && oi < match.originalIndex && ei < match.editedIndex) {
      // Both need to advance - prefer removal first, then addition
      path.push({
        type: "removed",
        originalIndex: oi,
        editedIndex: null,
      });
      oi++;
    } else if (match && oi < match.originalIndex) {
      // Original has extra block before next match - removed
      path.push({
        type: "removed",
        originalIndex: oi,
        editedIndex: null,
      });
      oi++;
    } else if (match && ei < match.editedIndex) {
      // Edited has extra block before next match - added
      path.push({
        type: "added",
        originalIndex: null,
        editedIndex: ei,
      });
      ei++;
    } else if (!match) {
      // No more matches - process remaining blocks
      // Prefer removing original blocks first, then adding edited blocks
      if (oi < originalLength) {
        path.push({
          type: "removed",
          originalIndex: oi,
          editedIndex: null,
        });
        oi++;
      } else {
        path.push({
          type: "added",
          originalIndex: null,
          editedIndex: ei,
        });
        ei++;
      }
    } else {
      // Fallback: should not reach here, but advance to prevent infinite loop
      console.warn(`[LCS] generateDiffPath unexpected state: oi=${oi}, ei=${ei}, mi=${mi}, match=${JSON.stringify(match)}`);
      if (oi < originalLength) {
        oi++;
      }
      if (ei < editedLength) {
        ei++;
      }
    }
  }

  console.log(`[LCS] generateDiffPath done, pathLen=${path.length}`);
  return path;
}

/**
 * Compute the full LCS-based diff path between two block arrays.
 *
 * @param original - Array of original blocks
 * @param edited - Array of edited blocks
 * @returns Diff path entries
 */
export function computeLCSDiff(
  original: NormalizedBlock[],
  edited: NormalizedBlock[]
): DiffPathEntry[] {
  const dp = buildLCSTable(original, edited);
  const matches = backtrackLCS(dp, original, edited);
  return generateDiffPath(matches, original.length, edited.length);
}
