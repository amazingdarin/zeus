/**
 * DocumentDiffViewer
 *
 * A component for displaying document diffs with two modes:
 * - display: Read-only diff view (for document editor)
 * - confirm: Interactive diff with accept/reject actions (for AI draft preview)
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "antd";
import { CheckOutlined, CloseOutlined } from "@ant-design/icons";
import type { JSONContent } from "@tiptap/react";

import {
  blockDiff,
  getStatusLabel,
  type BlockDiffEntry,
  type BlockDiffResult,
  type BlockDiffStatus,
  type RawBlock,
} from "@zeus/shared";

// ============================================
// Types
// ============================================

type DiffResolution = "accept" | "reject";

/**
 * A group of consecutive diff entries with the same status
 */
type DiffGroup = {
  id: string;
  status: BlockDiffStatus;
  entries: BlockDiffEntry[];
  isResolved: boolean;
  resolution?: DiffResolution;
};

type DocumentDiffViewerProps = {
  /** Original document content */
  originalContent: JSONContent;
  /** Proposed/modified document content */
  proposedContent: JSONContent;
  /** Project key for RichTextViewer */
  projectKey: string;
  /** Mode: display (read-only) or confirm (interactive) */
  mode?: "display" | "confirm";
  /** Callback when all changes are resolved (confirm mode only) */
  onResolved?: (finalContent: JSONContent) => void;
  /** Callback for resolution progress (confirm mode only) */
  onProgress?: (resolved: number, total: number) => void;
};

// ============================================
// Helper Functions
// ============================================

/**
 * Merge consecutive entries with the same status into groups.
 * Also merges consecutive removed + added into modified (replacement).
 * Note: 'modified' entries are NOT merged (each needs side-by-side comparison)
 */
function mergeIntoGroups(entries: BlockDiffEntry[]): DiffGroup[] {
  // First pass: group consecutive same-status entries
  const rawGroups: DiffGroup[] = [];
  let currentGroup: DiffGroup | null = null;
  let groupIndex = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    // Modified entries are never merged
    if (entry.status === "modified") {
      // Close current group if exists
      if (currentGroup) {
        rawGroups.push(currentGroup);
        currentGroup = null;
      }
      // Add modified as its own group
      rawGroups.push({
        id: `group-${groupIndex++}`,
        status: "modified",
        entries: [entry],
        isResolved: false,
      });
      continue;
    }

    // Check if we can merge with current group
    if (currentGroup && currentGroup.status === entry.status) {
      currentGroup.entries.push(entry);
    } else {
      // Close current group and start new one
      if (currentGroup) {
        rawGroups.push(currentGroup);
      }
      currentGroup = {
        id: `group-${groupIndex++}`,
        status: entry.status,
        entries: [entry],
        isResolved: false,
      };
    }
  }

  // Don't forget the last group
  if (currentGroup) {
    rawGroups.push(currentGroup);
  }

  // Second pass: merge consecutive removed + added into modified
  const finalGroups: DiffGroup[] = [];
  let finalIndex = 0;

  for (let i = 0; i < rawGroups.length; i++) {
    const group = rawGroups[i];
    const nextGroup = rawGroups[i + 1];

    // Check if this is a removed group followed by an added group
    if (
      group.status === "removed" &&
      nextGroup &&
      nextGroup.status === "added"
    ) {
      // Merge into a synthetic "modified" group
      // Create modified entries by pairing removed and added
      const removedEntries = group.entries;
      const addedEntries = nextGroup.entries;
      const maxLen = Math.max(removedEntries.length, addedEntries.length);
      const modifiedEntries: BlockDiffEntry[] = [];

      for (let j = 0; j < maxLen; j++) {
        const removed = removedEntries[j];
        const added = addedEntries[j];

        if (removed && added) {
          // Pair them as a modified entry
          modifiedEntries.push({
            status: "modified",
            blockId: added.blockId ?? removed.blockId,
            blockType: added.blockType ?? removed.blockType,
            original: removed.original,
            edited: added.edited,
          });
        } else if (removed) {
          // Extra removed (no matching add)
          modifiedEntries.push(removed);
        } else if (added) {
          // Extra added (no matching remove)
          modifiedEntries.push(added);
        }
      }

      finalGroups.push({
        id: `group-${finalIndex++}`,
        status: "modified",
        entries: modifiedEntries,
        isResolved: false,
      });

      // Skip the next group (already processed)
      i++;
    } else {
      // Keep as is
      finalGroups.push({
        ...group,
        id: `group-${finalIndex++}`,
      });
    }
  }

  return finalGroups;
}

/**
 * Get raw blocks from entries (either original or edited based on status)
 * 
 * @param entries - The diff entries to process
 * @param useEdited - Whether to prefer edited version (true) or original (false)
 * @param respectEntryStatus - If true, use entry's individual status to decide which version to use
 */
function getRawBlocksFromEntries(
  entries: BlockDiffEntry[], 
  useEdited: boolean,
  respectEntryStatus = false
): RawBlock[] {
  return entries
    .map((entry) => {
      let normalized;
      
      if (respectEntryStatus) {
        // For merged "modified" groups, respect each entry's actual status
        if (entry.status === "added") {
          // Added entries only have edited, use it if accepting
          normalized = useEdited ? entry.edited : null;
        } else if (entry.status === "removed") {
          // Removed entries only have original, use it if rejecting
          normalized = useEdited ? null : entry.original;
        } else {
          // For actual "modified" or "unchanged" entries, use the requested version
          normalized = useEdited ? entry.edited : entry.original;
        }
      } else {
        // Simple mode: just use the requested version
        normalized = useEdited ? entry.edited : entry.original;
      }
      
      // NormalizedBlock has a 'raw' property that contains the original RawBlock
      return normalized?.raw ?? null;
    })
    .filter((block): block is RawBlock => block != null);
}

// ============================================
// Component
// ============================================

export default function DocumentDiffViewer({
  originalContent,
  proposedContent,
  projectKey,
  mode = "display",
  onResolved,
  onProgress,
}: DocumentDiffViewerProps) {
  // Compute diff
  const diffResult: BlockDiffResult | null = useMemo(() => {
    try {
      return blockDiff(
        originalContent as RawBlock | null,
        proposedContent as RawBlock | null,
        { mergeConsecutive: false }
      );
    } catch (err) {
      console.error("[DocumentDiffViewer] blockDiff error:", err);
      return null;
    }
  }, [originalContent, proposedContent]);

  // Merge entries into groups
  const groups = useMemo(() => {
    if (!diffResult) return [];
    return mergeIntoGroups(diffResult.entries);
  }, [diffResult]);

  // Track resolutions for confirm mode
  const [resolutions, setResolutions] = useState<Map<string, DiffResolution>>(new Map());

  // Count groups that need resolution (non-unchanged)
  const groupsNeedingResolution = useMemo(() => {
    return groups.filter((g) => g.status !== "unchanged");
  }, [groups]);

  const resolvedCount = resolutions.size;
  const totalCount = groupsNeedingResolution.length;
  const allResolved = resolvedCount >= totalCount;

  // Report progress
  useEffect(() => {
    if (mode === "confirm" && onProgress) {
      onProgress(resolvedCount, totalCount);
    }
  }, [mode, onProgress, resolvedCount, totalCount]);

  // Handle group resolution
  const handleResolve = useCallback((groupId: string, resolution: DiffResolution) => {
    setResolutions((prev) => {
      const next = new Map(prev);
      next.set(groupId, resolution);
      return next;
    });
  }, []);

  // Accept all remaining
  const handleAcceptAll = useCallback(() => {
    setResolutions((prev) => {
      const next = new Map(prev);
      for (const group of groupsNeedingResolution) {
        if (!next.has(group.id)) {
          next.set(group.id, "accept");
        }
      }
      return next;
    });
  }, [groupsNeedingResolution]);

  // Build final content when all resolved
  const buildFinalContent = useCallback((): JSONContent => {
    const finalBlocks: RawBlock[] = [];

    for (const group of groups) {
      const resolution = resolutions.get(group.id);

      if (group.status === "unchanged") {
        // Keep unchanged blocks
        const blocks = getRawBlocksFromEntries(group.entries, false);
        finalBlocks.push(...blocks);
      } else if (group.status === "added") {
        // Include added blocks if accepted
        if (resolution !== "reject") {
          const blocks = getRawBlocksFromEntries(group.entries, true);
          finalBlocks.push(...blocks);
        }
      } else if (group.status === "removed") {
        // Keep removed blocks if rejected (i.e., don't remove)
        if (resolution === "reject") {
          const blocks = getRawBlocksFromEntries(group.entries, false);
          finalBlocks.push(...blocks);
        }
      } else if (group.status === "modified") {
        // For merged "modified" groups that may contain mixed entry types,
        // we need to handle each entry based on its actual status
        const useEdited = resolution !== "reject";
        
        // Process each entry individually based on its status
        for (const entry of group.entries) {
          let block: RawBlock | null = null;
          
          if (entry.status === "added") {
            // Added entries: include if accepted, skip if rejected
            if (useEdited && entry.edited?.raw) {
              block = entry.edited.raw;
            }
          } else if (entry.status === "removed") {
            // Removed entries: skip if accepted, include if rejected
            if (!useEdited && entry.original?.raw) {
              block = entry.original.raw;
            }
          } else {
            // Actual "modified" entries: use edited if accepted, original if rejected
            const source = useEdited ? entry.edited : entry.original;
            if (source?.raw) {
              block = source.raw;
            }
          }
          
          if (block) {
            finalBlocks.push(block);
          }
        }
      }
    }

    return {
      type: "doc",
      content: finalBlocks,
    };
  }, [groups, resolutions]);

  // Trigger onResolved when all resolved
  useEffect(() => {
    if (mode === "confirm" && allResolved && onResolved && totalCount > 0) {
      const finalContent = buildFinalContent();
      onResolved(finalContent);
    }
  }, [mode, allResolved, onResolved, totalCount, buildFinalContent]);

  // Render error state
  if (!diffResult) {
    return (
      <div className="document-diff-viewer">
        <div className="diff-error">无法计算文档差异</div>
      </div>
    );
  }

  // Render empty state
  if (groups.length === 0) {
    return (
      <div className="document-diff-viewer">
        <div className="diff-empty">未检测到变更</div>
      </div>
    );
  }

  // Render a single group
  const renderGroup = (group: DiffGroup) => {
    const resolution = resolutions.get(group.id);
    const isResolved = resolution != null;
    const isConfirmMode = mode === "confirm";
    const showActions = isConfirmMode && group.status !== "unchanged" && !isResolved;

    // Helper to wrap raw blocks in a doc structure
    const wrapInDoc = (blocks: RawBlock[]): JSONContent => ({
      type: "doc",
      content: blocks,
    });

    // Simple text renderer for blocks (lightweight alternative to RichTextViewer)
    const renderSimpleContent = (blocks: RawBlock[]) => {
      const renderNode = (node: RawBlock, index: number, depth = 0): React.ReactNode => {
        if (!node) {
          return null;
        }
        
        const key = `${node.type || 'text'}-${depth}-${index}`;
        
        // Text node
        if (node.text !== undefined) {
          return <span key={key}>{node.text}</span>;
        }
        
        // No type means it might be a text wrapper or unknown
        if (!node.type) {
          if (node.content && Array.isArray(node.content)) {
            return <>{node.content.map((child, i) => renderNode(child as RawBlock, i, depth + 1))}</>;
          }
          return null;
        }
        
        // Render children
        const children = node.content?.map((child, i) => renderNode(child as RawBlock, i, depth + 1));
        
        switch (node.type) {
          case 'heading': {
            const level = (node.attrs?.level as number) || 1;
            // Use React.createElement for dynamic heading tags to avoid JSX type issues
            return React.createElement(`h${level}`, { key }, children);
          }
          case 'paragraph':
            return <p key={key}>{children && (Array.isArray(children) && children.length > 0) ? children : '\u00A0'}</p>;
          case 'bulletList':
            return <ul key={key}>{children}</ul>;
          case 'orderedList':
            return <ol key={key}>{children}</ol>;
          case 'listItem':
            return <li key={key}>{children}</li>;
          case 'taskList':
            return <ul key={key} className="task-list">{children}</ul>;
          case 'taskItem':
            return <li key={key} className="task-item">{children}</li>;
          case 'codeBlock':
            return <pre key={key}><code>{children}</code></pre>;
          case 'blockquote':
            return <blockquote key={key}>{children}</blockquote>;
          case 'horizontalRule':
            return <hr key={key} />;
          case 'text':
            return <span key={key}>{node.text}</span>;
          default:
            // For unknown types, try to render children
            if (children && Array.isArray(children) && children.length > 0) {
              return <div key={key}>{children}</div>;
            }
            return null;
        }
      };
      
      return (
        <div className="simple-content-renderer">
          {blocks.map((block, i) => renderNode(block, i, 0))}
        </div>
      );
    };

    // Get content to display
    const getGroupContent = () => {
      if (group.status === "unchanged" || group.status === "removed") {
        // Show original blocks
        const blocks = getRawBlocksFromEntries(group.entries, false);
        if (blocks.length === 0) return null;
        return renderSimpleContent(blocks);
      }

      if (group.status === "added") {
        // Show edited blocks
        const blocks = getRawBlocksFromEntries(group.entries, true);
        if (blocks.length === 0) return null;
        return renderSimpleContent(blocks);
      }

      if (group.status === "modified") {
        // Show side-by-side comparison for all entries in the group
        // Collect all original and edited blocks
        const originalBlocks: RawBlock[] = [];
        const editedBlocks: RawBlock[] = [];

        for (const entry of group.entries) {
          if (entry.original?.raw) {
            originalBlocks.push(entry.original.raw);
          }
          if (entry.edited?.raw) {
            editedBlocks.push(entry.edited.raw);
          }
        }

        return (
          <div className="diff-modified-content">
            <div className="diff-side diff-original">
              <div className="diff-side-label">原始</div>
              {originalBlocks.length > 0 && renderSimpleContent(originalBlocks)}
            </div>
            <div className="diff-side diff-edited">
              <div className="diff-side-label">修改后</div>
              {editedBlocks.length > 0 && renderSimpleContent(editedBlocks)}
            </div>
          </div>
        );
      }

      return null;
    };

    // Unchanged blocks - render without decoration
    if (group.status === "unchanged") {
      return (
        <div key={group.id} className="diff-group diff-unchanged">
          {getGroupContent()}
        </div>
      );
    }

    // Changed blocks - render with status decoration
    return (
      <div
        key={group.id}
        className={`diff-group diff-${group.status}${isResolved ? " resolved" : ""}`}
      >
        <div className="diff-group-header">
          <span className="diff-status-label">
            {getStatusLabel(group.status)}
            {group.entries.length > 1 && ` (${group.entries.length})`}
          </span>
          {isResolved && (
            <span className="diff-resolution">
              {resolution === "accept" ? "✓ 已接受" : "✗ 已拒绝"}
            </span>
          )}
        </div>

        <div className="diff-group-content">{getGroupContent()}</div>

        {showActions && (
          <div className="diff-group-actions">
            <Button
              size="small"
              type="primary"
              icon={<CheckOutlined />}
              onClick={() => handleResolve(group.id, "accept")}
            >
              接受
            </Button>
            <Button
              size="small"
              icon={<CloseOutlined />}
              onClick={() => handleResolve(group.id, "reject")}
            >
              拒绝
            </Button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="document-diff-viewer">
      {/* Header with progress (confirm mode only) */}
      {mode === "confirm" && totalCount > 0 && (
        <div className="diff-viewer-header">
          <span className="diff-progress">
            已处理 {resolvedCount}/{totalCount}
          </span>
          {!allResolved && (
            <Button size="small" onClick={handleAcceptAll}>
              接受全部
            </Button>
          )}
        </div>
      )}

      {/* Diff groups */}
      <div className="diff-groups">
        {groups.map(renderGroup)}
      </div>
    </div>
  );
}

/**
 * Export a helper to get final content imperatively
 */
export function getFinalContentFromDiff(
  originalContent: JSONContent,
  proposedContent: JSONContent,
  resolutions: Map<string, DiffResolution>
): JSONContent | null {
  try {
    const diffResult = blockDiff(
      originalContent as RawBlock | null,
      proposedContent as RawBlock | null,
      { mergeConsecutive: false }
    );

    if (!diffResult) return null;

    const groups = mergeIntoGroups(diffResult.entries);
    const finalBlocks: RawBlock[] = [];

    for (const group of groups) {
      const resolution = resolutions.get(group.id);

      if (group.status === "unchanged") {
        const blocks = getRawBlocksFromEntries(group.entries, false);
        finalBlocks.push(...blocks);
      } else if (group.status === "added") {
        if (resolution !== "reject") {
          const blocks = getRawBlocksFromEntries(group.entries, true);
          finalBlocks.push(...blocks);
        }
      } else if (group.status === "removed") {
        if (resolution === "reject") {
          const blocks = getRawBlocksFromEntries(group.entries, false);
          finalBlocks.push(...blocks);
        }
      } else if (group.status === "modified") {
        // For merged "modified" groups that may contain mixed entry types,
        // we need to handle each entry based on its actual status
        const useEdited = resolution !== "reject";
        
        for (const entry of group.entries) {
          let block: RawBlock | null = null;
          
          if (entry.status === "added") {
            // Added entries: include if accepted, skip if rejected
            if (useEdited && entry.edited?.raw) {
              block = entry.edited.raw;
            }
          } else if (entry.status === "removed") {
            // Removed entries: skip if accepted, include if rejected
            if (!useEdited && entry.original?.raw) {
              block = entry.original.raw;
            }
          } else {
            // Actual "modified" entries: use edited if accepted, original if rejected
            const source = useEdited ? entry.edited : entry.original;
            if (source?.raw) {
              block = source.raw;
            }
          }
          
          if (block) {
            finalBlocks.push(block);
          }
        }
      }
    }

    return {
      type: "doc",
      content: finalBlocks,
    };
  } catch {
    return null;
  }
}
