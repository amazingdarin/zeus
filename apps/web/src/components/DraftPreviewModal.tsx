/**
 * Draft Preview Modal
 *
 * Modal for previewing AI-generated document drafts with DIFF view for edits.
 */

import { useCallback, useMemo, useState } from "react";
import { Modal, Button, message } from "antd";
import {
  CheckOutlined,
  CloseOutlined,
  FileTextOutlined,
  EditOutlined,
} from "@ant-design/icons";
import type { JSONContent } from "@tiptap/react";

import type { DocumentDraft } from "../api/drafts";
import { applyDraft, rejectDraft } from "../api/drafts";
import RichTextViewer from "./RichTextViewer";
import {
  blockDiff,
  getStatusLabel,
  wrapBlockInDoc,
  type BlockDiffResult,
  type RawBlock,
} from "@zeus/shared";

type DraftPreviewModalProps = {
  draft: DocumentDraft;
  projectKey: string;
  onClose: () => void;
  onApplied: (docId: string, isNew: boolean) => void;
};

type DiffResolution = "accept" | "reject";

function DraftPreviewModal({
  draft,
  projectKey,
  onClose,
  onApplied,
}: DraftPreviewModalProps) {
  const [applying, setApplying] = useState(false);
  const [resolvedDiffs, setResolvedDiffs] = useState<Map<number, DiffResolution>>(
    new Map(),
  );

  // Compute diff for edit mode
  const diffResult: BlockDiffResult | null = useMemo(() => {
    if (!draft.originalContent) {
      // New document - no diff needed
      return null;
    }

    try {
      return blockDiff(
        draft.originalContent as RawBlock | null,
        draft.proposedContent as RawBlock | null,
        {
          ignoreAttrs: ["id", "updated_at", "created_at"],
          mergeConsecutive: false,
        },
      );
    } catch (err) {
      console.error("[DraftPreviewModal] blockDiff error:", err);
      return null;
    }
  }, [draft.originalContent, draft.proposedContent]);

  // Changed entries (non-unchanged)
  const changedEntries = useMemo(() => {
    if (!diffResult) return [];
    return diffResult.entries.filter((entry) => entry.status !== "unchanged");
  }, [diffResult]);

  // Resolution tracking
  const resolvedCount = resolvedDiffs.size;
  const allResolved =
    changedEntries.length > 0 && resolvedCount >= changedEntries.length;

  // Handle diff resolution
  const handleResolveDiff = useCallback(
    (entryIndex: number, action: DiffResolution) => {
      setResolvedDiffs((prev) => {
        const next = new Map(prev);
        next.set(entryIndex, action);
        return next;
      });
    },
    [],
  );

  // Accept all remaining changes
  const handleAcceptAllRemaining = useCallback(() => {
    if (!diffResult) return;

    setResolvedDiffs((prev) => {
      const next = new Map(prev);
      diffResult.entries.forEach((entry, index) => {
        if (entry.status !== "unchanged" && !next.has(index)) {
          next.set(index, "accept");
        }
      });
      return next;
    });
  }, [diffResult]);

  // Build final content based on resolutions
  const buildFinalContent = useCallback((): JSONContent => {
    if (!diffResult) {
      // New document - use proposed content as is
      return draft.proposedContent;
    }

    // Build content based on resolutions
    const finalBlocks: JSONContent[] = [];

    diffResult.entries.forEach((entry, index) => {
      const resolution = resolvedDiffs.get(index);

      if (entry.status === "unchanged") {
        // Keep unchanged blocks
        if (entry.original) {
          finalBlocks.push(entry.original);
        }
      } else if (entry.status === "added") {
        // Include added blocks if accepted (default) or not explicitly rejected
        if (resolution !== "reject") {
          if (entry.edited) {
            finalBlocks.push(entry.edited);
          }
        }
      } else if (entry.status === "removed") {
        // Include removed blocks if rejected (i.e., keep original)
        if (resolution === "reject") {
          if (entry.original) {
            finalBlocks.push(entry.original);
          }
        }
        // If accepted, block is removed (not added to final)
      } else if (entry.status === "modified") {
        // Use edited version if accepted (default), original if rejected
        if (resolution === "reject") {
          if (entry.original) {
            finalBlocks.push(entry.original);
          }
        } else {
          if (entry.edited) {
            finalBlocks.push(entry.edited);
          }
        }
      }
    });

    return {
      type: "doc",
      content: finalBlocks,
    };
  }, [draft.proposedContent, diffResult, resolvedDiffs]);

  // Handle apply
  const handleApply = useCallback(async () => {
    setApplying(true);
    try {
      const finalContent = buildFinalContent();
      const result = await applyDraft(projectKey, draft.id, finalContent);
      message.success(result.isNew ? "文档已创建" : "文档已更新");
      onApplied(result.docId, result.isNew);
      onClose();
    } catch (err) {
      message.error(`应用草稿失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setApplying(false);
    }
  }, [buildFinalContent, draft.id, onApplied, onClose, projectKey]);

  // Handle reject
  const handleReject = useCallback(async () => {
    try {
      await rejectDraft(projectKey, draft.id);
      message.info("草稿已拒绝");
      onClose();
    } catch (err) {
      message.error(`拒绝草稿失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [draft.id, onClose, projectKey]);

  // Render new document preview
  const renderNewDocumentPreview = () => (
    <div className="draft-preview-content">
      <div className="draft-preview-header">
        <FileTextOutlined />
        <span>新建文档预览</span>
      </div>
      <div className="draft-preview-body">
        <RichTextViewer content={draft.proposedContent} projectKey={projectKey} />
      </div>
    </div>
  );

  // Render edit diff view
  const renderEditDiffView = () => {
    if (!diffResult) {
      return (
        <div className="draft-preview-content">
          <div className="doc-viewer-state">无法计算差异</div>
        </div>
      );
    }

    return (
      <div className="draft-preview-content">
        <div className="draft-preview-header">
          <EditOutlined />
          <span>文档修改预览</span>
          {changedEntries.length > 0 && (
            <span className="draft-preview-progress">
              已解决 {resolvedCount}/{changedEntries.length}
            </span>
          )}
        </div>

        <div className="draft-preview-diff">
          {diffResult.entries.length === 0 ? (
            <div className="doc-viewer-state">未检测到变更</div>
          ) : (
            diffResult.entries.map((entry, index) => {
              const originalDoc = entry.original
                ? wrapBlockInDoc(entry.original)
                : null;
              const editedDoc = entry.edited ? wrapBlockInDoc(entry.edited) : null;
              const isResolved = resolvedDiffs.has(index);
              const resolution = resolvedDiffs.get(index);

              if (entry.status === "unchanged") {
                return (
                  <div key={`unchanged-${index}`} className="draft-diff-plain">
                    {originalDoc && (
                      <RichTextViewer
                        content={originalDoc as JSONContent}
                        projectKey={projectKey}
                      />
                    )}
                  </div>
                );
              }

              return (
                <div
                  key={`${entry.status}-${index}`}
                  className={`draft-diff-block draft-diff-${entry.status}${isResolved ? " resolved" : ""}`}
                >
                  <div className="draft-diff-label">
                    {getStatusLabel(entry.status)}
                    {isResolved && (
                      <span className="draft-diff-resolution">
                        {resolution === "accept" ? "✓ 已接受" : "✗ 已拒绝"}
                      </span>
                    )}
                  </div>

                  <div className="draft-diff-content">
                    {entry.status === "modified" && (
                      <>
                        <div className="draft-diff-side draft-diff-original">
                          <div className="draft-diff-side-label">原始</div>
                          {originalDoc && (
                            <RichTextViewer
                              content={originalDoc as JSONContent}
                              projectKey={projectKey}
                            />
                          )}
                        </div>
                        <div className="draft-diff-side draft-diff-edited">
                          <div className="draft-diff-side-label">修改后</div>
                          {editedDoc && (
                            <RichTextViewer
                              content={editedDoc as JSONContent}
                              projectKey={projectKey}
                            />
                          )}
                        </div>
                      </>
                    )}

                    {entry.status === "added" && editedDoc && (
                      <RichTextViewer
                        content={editedDoc as JSONContent}
                        projectKey={projectKey}
                      />
                    )}

                    {entry.status === "removed" && originalDoc && (
                      <RichTextViewer
                        content={originalDoc as JSONContent}
                        projectKey={projectKey}
                      />
                    )}
                  </div>

                  {!isResolved && (
                    <div className="draft-diff-actions">
                      <Button
                        size="small"
                        type="primary"
                        icon={<CheckOutlined />}
                        onClick={() => handleResolveDiff(index, "accept")}
                      >
                        接受
                      </Button>
                      <Button
                        size="small"
                        icon={<CloseOutlined />}
                        onClick={() => handleResolveDiff(index, "reject")}
                      >
                        拒绝
                      </Button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  };

  const isEditMode = draft.originalContent !== null;
  const canApply = !isEditMode || changedEntries.length === 0 || allResolved;

  return (
    <Modal
      title={
        <span>
          {isEditMode ? <EditOutlined /> : <FileTextOutlined />}
          {" "}
          {draft.title}
          {isEditMode ? " - 编辑预览" : " - 新建预览"}
        </span>
      }
      open={true}
      onCancel={onClose}
      width={900}
      className="draft-preview-modal"
      footer={
        <div className="draft-preview-footer">
          {isEditMode && changedEntries.length > 0 && !allResolved && (
            <Button onClick={handleAcceptAllRemaining}>接受全部变更</Button>
          )}
          <Button onClick={handleReject}>拒绝</Button>
          <Button
            type="primary"
            onClick={handleApply}
            loading={applying}
            disabled={!canApply}
          >
            {isEditMode ? "应用修改" : "创建文档"}
          </Button>
        </div>
      }
    >
      {isEditMode ? renderEditDiffView() : renderNewDocumentPreview()}
    </Modal>
  );
}

export default DraftPreviewModal;
