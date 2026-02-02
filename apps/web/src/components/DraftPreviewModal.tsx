/**
 * Draft Preview Modal
 *
 * Modal for previewing AI-generated document drafts with DIFF view for edits.
 * Uses DocumentDiffViewer for the diff display.
 */

import { useCallback, useEffect, useState } from "react";
import { Modal, Button, message, TreeSelect, Spin, Radio, Input } from "antd";
import {
  FileTextOutlined,
  EditOutlined,
  FolderOutlined,
  CopyOutlined,
} from "@ant-design/icons";
import type { JSONContent } from "@tiptap/react";

import type { DocumentDraft } from "../api/drafts";
import { applyDraft, rejectDraft } from "../api/drafts";
import { fetchDocumentTree, type DocumentTreeItem } from "../api/documents";
import RichTextViewer from "./RichTextViewer";
import DocumentDiffViewer from "./DocumentDiffViewer";

type DraftPreviewModalProps = {
  draft: DocumentDraft;
  projectKey: string;
  onClose: () => void;
  onApplied: (docId: string, isNew: boolean) => void;
};

// Convert document tree to TreeSelect format
type TreeSelectNode = {
  value: string;
  title: string;
  children?: TreeSelectNode[];
};

function convertToTreeSelectData(
  items: DocumentTreeItem[],
  parentPath = "",
): TreeSelectNode[] {
  return items.map((item) => {
    const path = parentPath ? `${parentPath}/${item.title}` : item.title;
    return {
      value: item.id,
      title: path,
      children: item.children ? convertToTreeSelectData(item.children, path) : undefined,
    };
  });
}

function DraftPreviewModal({
  draft,
  projectKey,
  onClose,
  onApplied,
}: DraftPreviewModalProps) {
  const [applying, setApplying] = useState(false);

  // Parent document state
  const [parentId, setParentId] = useState<string | null>(draft.parentId);
  const [treeData, setTreeData] = useState<TreeSelectNode[]>([]);
  const [loadingTree, setLoadingTree] = useState(false);

  // Save mode state (only for edit mode)
  const [saveMode, setSaveMode] = useState<"overwrite" | "new">("overwrite");
  const [newTitle, setNewTitle] = useState<string>(`${draft.title} (副本)`);

  // Track resolved content from DocumentDiffViewer
  const [resolvedContent, setResolvedContent] = useState<JSONContent | null>(null);
  const [diffProgress, setDiffProgress] = useState({ resolved: 0, total: 0 });

  const isEditMode = draft.originalContent !== null;

  // Load document tree for parent selection
  useEffect(() => {
    if (projectKey) {
      setLoadingTree(true);
      fetchDocumentTree(projectKey)
        .then((tree) => {
          const data = convertToTreeSelectData(tree);
          setTreeData([
            { value: "", title: "根目录" },
            ...data,
          ]);
        })
        .catch((err) => {
          console.error("Failed to load document tree:", err);
        })
        .finally(() => {
          setLoadingTree(false);
        });
    }
  }, [projectKey]);

  // Handle diff resolved callback
  const handleDiffResolved = useCallback((finalContent: JSONContent) => {
    setResolvedContent(finalContent);
  }, []);

  // Handle diff progress callback
  const handleDiffProgress = useCallback((resolved: number, total: number) => {
    setDiffProgress({ resolved, total });
  }, []);

  // Check if can apply
  const canApply = !isEditMode || diffProgress.total === 0 || resolvedContent !== null;

  // Handle apply
  const handleApply = useCallback(async () => {
    setApplying(true);
    try {
      // Determine final content
      let finalContent: JSONContent;
      if (isEditMode && resolvedContent) {
        finalContent = resolvedContent;
      } else {
        finalContent = draft.proposedContent;
      }

      const isSaveAsNew = isEditMode && saveMode === "new";
      
      const result = await applyDraft(projectKey, draft.id, {
        modifiedContent: finalContent,
        parentId: (!draft.docId || isSaveAsNew) ? parentId : undefined,
        saveAsNew: isSaveAsNew,
        newTitle: isSaveAsNew ? newTitle : undefined,
      });
      
      if (isSaveAsNew) {
        message.success("文档副本已创建");
      } else {
        message.success(result.isNew ? "文档已创建" : "文档已更新");
      }
      onApplied(result.docId, result.isNew);
      onClose();
    } catch (err) {
      message.error(`应用草稿失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setApplying(false);
    }
  }, [draft, isEditMode, resolvedContent, saveMode, projectKey, parentId, newTitle, onApplied, onClose]);

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

  // Get parent document title for display
  const getParentTitle = useCallback((id: string | null): string => {
    if (!id) return "根目录";
    const findNode = (nodes: TreeSelectNode[]): string | null => {
      for (const node of nodes) {
        if (node.value === id) return node.title;
        if (node.children) {
          const found = findNode(node.children);
          if (found) return found;
        }
      }
      return null;
    };
    return findNode(treeData) || id;
  }, [treeData]);

  // Determine apply button text
  const getApplyButtonText = () => {
    if (!isEditMode) return "创建文档";
    if (saveMode === "new") return "创建副本";
    return "应用修改";
  };

  // Render new document preview
  const renderNewDocumentPreview = () => (
    <div className="draft-preview-content">
      <div className="draft-preview-header">
        <FileTextOutlined />
        <span>新建文档预览</span>
      </div>

      {/* Parent document selector */}
      <div className="draft-parent-selector">
        <label className="draft-parent-label">
          <FolderOutlined />
          <span>父文档：</span>
        </label>
        {loadingTree ? (
          <Spin size="small" />
        ) : (
          <TreeSelect
            value={parentId || ""}
            onChange={(value) => setParentId(value || null)}
            treeData={treeData}
            placeholder="选择父文档"
            allowClear
            treeDefaultExpandAll
            style={{ width: 300 }}
            dropdownStyle={{ maxHeight: 400, overflow: "auto" }}
          />
        )}
        {parentId && (
          <span className="draft-parent-path" title={getParentTitle(parentId)}>
            {getParentTitle(parentId)}
          </span>
        )}
      </div>

      <div className="draft-preview-body">
        <RichTextViewer content={draft.proposedContent} projectKey={projectKey} />
      </div>
    </div>
  );

  // Render save mode selector (for edit mode)
  const renderSaveModeSelector = () => (
    <div className="draft-save-mode-section">
      <div className="draft-save-mode-label">保存方式：</div>
      <Radio.Group
        value={saveMode}
        onChange={(e) => setSaveMode(e.target.value)}
        optionType="button"
        buttonStyle="solid"
        size="small"
      >
        <Radio.Button value="overwrite">
          <EditOutlined /> 覆盖原文档
        </Radio.Button>
        <Radio.Button value="new">
          <CopyOutlined /> 另存为新文档
        </Radio.Button>
      </Radio.Group>

      {saveMode === "new" && (
        <div className="draft-save-new-options">
          <div className="draft-save-new-row">
            <label className="draft-parent-label">
              <FileTextOutlined />
              <span>新文档标题：</span>
            </label>
            <Input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="输入新文档标题"
              style={{ width: 300 }}
            />
          </div>
          <div className="draft-save-new-row">
            <label className="draft-parent-label">
              <FolderOutlined />
              <span>父文档：</span>
            </label>
            {loadingTree ? (
              <Spin size="small" />
            ) : (
              <TreeSelect
                value={parentId || ""}
                onChange={(value) => setParentId(value || null)}
                treeData={treeData}
                placeholder="选择父文档"
                allowClear
                treeDefaultExpandAll
                style={{ width: 300 }}
                dropdownStyle={{ maxHeight: 400, overflow: "auto" }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );

  // Render edit diff view using DocumentDiffViewer
  const renderEditDiffView = () => {
    return (
      <div className="draft-preview-content">
        <div className="draft-preview-header">
          <EditOutlined />
          <span>文档修改预览</span>
        </div>

        {/* Save mode selector */}
        {renderSaveModeSelector()}

        {/* Diff viewer in confirm mode */}
        <DocumentDiffViewer
          originalContent={draft.originalContent!}
          proposedContent={draft.proposedContent}
          projectKey={projectKey}
          mode="confirm"
          onResolved={handleDiffResolved}
          onProgress={handleDiffProgress}
        />
      </div>
    );
  };

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
          <Button onClick={handleReject}>拒绝</Button>
          <Button
            type="primary"
            onClick={handleApply}
            loading={applying}
            disabled={!canApply}
            icon={saveMode === "new" ? <CopyOutlined /> : undefined}
          >
            {getApplyButtonText()}
          </Button>
        </div>
      }
    >
      {isEditMode ? renderEditDiffView() : renderNewDocumentPreview()}
    </Modal>
  );
}

export default DraftPreviewModal;
