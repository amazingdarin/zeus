import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSONContent } from "@tiptap/react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Modal } from "antd";

import RichTextEditor from "../components/RichTextEditor";
import RichTextViewer from "../components/RichTextViewer";
import { useScrollToBlock } from "@zeus/doc-editor";
import {
  exportContentJson,
  type ContentMetaInput,
} from "../utils/exportContentJson";
import { createDocument, fetchDocument } from "../api/documents";
import { fetchStorageObjectDownload } from "../api/storage";
import { useProjectContext } from "../context/ProjectContext";
import { sanitizeFileName } from "../utils/fileName";

// Import block-diff utilities from shared
import {
  blockDiff,
  getStatusLabel,
  wrapBlockInDoc,
  type BlockDiffEntry,
  type BlockDiffResult,
  type RawBlock,
} from "@zeus/shared";

// Resolution action type
type DiffResolution = "accept" | "reject";

function NewDocumentPage() {
  const { currentProject } = useProjectContext();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [content, setContent] = useState<JSONContent | null>(null);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadingDocument, setLoadingDocument] = useState(false);
  const [documentId, setDocumentId] = useState("");
  const [parentID, setParentID] = useState("");
  const [contentMeta, setContentMeta] = useState<ContentMetaInput>(null);
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonDraft, setJsonDraft] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [diffMode, setDiffMode] = useState(false);
  const [baselineContent, setBaselineContent] = useState<JSONContent | null>(null);
  const currentRequestRef = useRef<string | null>(null);
  
  // Diff resolution state - tracks which entries have been resolved and how
  const [resolvedDiffs, setResolvedDiffs] = useState<Map<number, DiffResolution>>(new Map());

  const parentIdParam = useMemo(() => {
    return (searchParams.get("parent_id") || "").trim();
  }, [searchParams]);
  const documentIdParam = useMemo(() => {
    return (searchParams.get("document_id") || "").trim();
  }, [searchParams]);
  const blockIdParam = useMemo(() => {
    return (searchParams.get("block") || "").trim() || null;
  }, [searchParams]);
  const [editorReady, setEditorReady] = useState(false);
  
  // Scroll to block if specified in URL
  useScrollToBlock(blockIdParam, editorReady && !loadingDocument);

  const contentPayload = useMemo(() => {
    return exportContentJson(
      content ?? { type: "doc", content: [] },
      contentMeta,
    );
  }, [content, contentMeta]);

  const parsedJsonDraft = useMemo(() => {
    if (!jsonMode) {
      return null;
    }
    return parseContentJson(jsonDraft);
  }, [jsonDraft, jsonMode]);

  const diffContent = useMemo(() => {
    if (jsonMode) {
      return parsedJsonDraft?.content ?? null;
    }
    return content;
  }, [content, jsonMode, parsedJsonDraft]);

  const diffContentError = useMemo(() => {
    if (!jsonMode) {
      return null;
    }
    if (!jsonDraft.trim()) {
      return null;
    }
    return parsedJsonDraft ? null : "Invalid JSON content.";
  }, [jsonDraft, jsonMode, parsedJsonDraft]);

  // Use new block-diff module
  const diffResult: BlockDiffResult = useMemo(() => {
    console.log(`[NewDocumentPage] diffResult useMemo triggered`);
    // Only compute diff when both contents are available
    if (!baselineContent || !diffContent) {
      console.log(`[NewDocumentPage] diffResult: no content, returning empty`);
      return { entries: [], stats: { added: 0, removed: 0, modified: 0, unchanged: 0, total: 0 } };
    }
    try {
      console.log(`[NewDocumentPage] calling blockDiff...`);
      const result = blockDiff(
        baselineContent as RawBlock | null,
        diffContent as RawBlock | null,
        {
          computeFieldChanges: true,
          includeUnchanged: true,
          mergeConsecutive: false,
        }
      );
      console.log(`[NewDocumentPage] blockDiff done, entries=${result.entries.length}`);
      return result;
    } catch (err) {
      console.error("[NewDocumentPage] blockDiff error:", err);
      return { entries: [], stats: { added: 0, removed: 0, modified: 0, unchanged: 0, total: 0 } };
    }
  }, [baselineContent, diffContent]);

  // Compute changed entries and resolution progress
  const changedEntries = useMemo(() => {
    return diffResult.entries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.status !== "unchanged");
  }, [diffResult.entries]);

  const resolvedCount = useMemo(() => {
    let count = 0;
    for (const { index } of changedEntries) {
      if (resolvedDiffs.has(index)) {
        count++;
      }
    }
    return count;
  }, [changedEntries, resolvedDiffs]);

  const allResolved = changedEntries.length > 0 && resolvedCount === changedEntries.length;

  useEffect(() => {
    if (jsonMode) {
      setJsonDraft(JSON.stringify(contentPayload, null, 2));
      setJsonError(null);
    }
  }, [contentPayload, jsonMode]);

  const handleLoadDocument = useCallback(async (id: string) => {
    if (!currentProject?.key) return { type: "doc", content: [] };

    setLoadingDocument(true);
    try {
      const detail = await fetchDocument(currentProject.key, id);

      const metaValue = detail?.meta;
      let contentToReturn: JSONContent | null = null;

      if (metaValue) {
        setTitle(String(metaValue.title ?? ""));
        setParentID(String(metaValue.parent_id ?? metaValue.parent ?? "").trim());

        const bodyValue = detail?.body ?? detail?.content ?? {};
        const contentValue =
          bodyValue &&
            typeof bodyValue === "object" &&
            "type" in bodyValue &&
            "content" in bodyValue
            ? (bodyValue as { content?: unknown }).content
            : bodyValue;
        const contentMetaValue =
          contentValue &&
            typeof contentValue === "object" &&
            "meta" in contentValue &&
            typeof (contentValue as { meta?: unknown }).meta === "object"
            ? ((contentValue as { meta?: EditorMeta }).meta ?? null)
            : null;
        setContentMeta(contentMetaValue as ContentMetaInput);

        const nestedContent =
          contentValue &&
            typeof contentValue === "object" &&
            "content" in contentValue
            ? (contentValue as { content?: unknown }).content
            : null;
        if (
          nestedContent &&
          typeof nestedContent === "object" &&
          !Array.isArray(nestedContent) &&
          "type" in (nestedContent as Record<string, unknown>)
        ) {
          contentToReturn = nestedContent as JSONContent;
        } else if (
          contentValue &&
          typeof contentValue === "object" &&
          "type" in contentValue
        ) {
          contentToReturn = contentValue as JSONContent;
        }
      } else {
        setTitle(String(detail?.title ?? ""));
        setParentID(String(detail?.parent_id ?? "").trim());

        const storageId = String(detail?.storage_object_id ?? "").trim();
        if (storageId) {
          // We create a one-off controller just for this fetch
          const controller = new AbortController();
          const downloadInfo = await fetchStorageObjectDownload(
            currentProject.key,
            storageId,
            controller.signal
          );
          const download = downloadInfo?.download?.url;
          if (download) {
            const response = await fetch(download, { signal: controller.signal });
            if (response.ok) {
              const text = await response.text();
              const parsed = parseEditorPayload(text);
              if (parsed) {
                contentToReturn = parsed.content;
                setContentMeta(parsed.meta ? (parsed.meta as ContentMetaInput) : null);
              }
            }
          }
        }
      }

      if (contentToReturn) {
        setBaselineContent(contentToReturn);
      }

      return contentToReturn || { type: "doc", content: [] };
    } catch (err) {
      setSaveError("Failed to load document.");
      throw err;
    } finally {
      setLoadingDocument(false);
    }
  }, [currentProject?.key]);

  useEffect(() => {
    setDocumentId(documentIdParam);
    if (!documentIdParam) {
      setParentID(parentIdParam);
      setContent(null);
      setContentMeta(null);
      setSaveError(null);
      setDiffMode(false);
      setBaselineContent(null);
      currentRequestRef.current = null;
      return;
    }
  }, [documentIdParam, parentIdParam]);

  const handleSave = async () => {

    const projectKey = currentProject?.key ?? "";
    if (!projectKey) {
      setSaveError("Project is required before saving.");
      return;
    }
    setSaveError(null);
    setSaving(true);

    try {
      let payloadForSave = exportContentJson(
        content ?? { type: "doc", content: [] },
        contentMeta,
      );
      if (jsonMode) {
        const parsed = parseContentJson(jsonDraft);
        if (!parsed) {
          setJsonError("Invalid JSON content.");
          setSaving(false);
          return;
        }
        payloadForSave = exportContentJson(
          parsed.content,
          parsed.meta ? (parsed.meta as ContentMetaInput) : null,
        );
        setContent(parsed.content);
        setContentMeta(parsed.meta ? (parsed.meta as ContentMetaInput) : null);
      }
      let documentPayload;
      const normalizedTitle = title.trim() || "无标题文档";
      const safeSlug = sanitizeFileName(normalizedTitle);
      const meta = {
        id: documentId || undefined,
        slug: safeSlug || undefined,
        title: normalizedTitle,
        parent_id: (parentID || parentIdParam || "root").trim(),
        extra: {
          status: "draft",
          tags: [],
        },
      };
      documentPayload = await createDocument(projectKey, meta, {
        type: "tiptap",
        content: payloadForSave,
      });
      const targetID = String(
        documentPayload?.meta?.id ?? documentPayload?.id ?? documentId ?? "",
      );
      if (targetID) {
        navigate(`/documents/${encodeURIComponent(targetID)}`, {
          state: { refreshToken: Date.now() },
        });
      }
      setContentMeta(payloadForSave.meta);
      console.log("document_saved", documentPayload);
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "Failed to save document.",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleToggleJsonMode = () => {
    if (!jsonMode) {
      setJsonMode(true);
      return;
    }
    const parsed = parseContentJson(jsonDraft);
    if (!parsed) {
      setJsonError("Invalid JSON content.");
      return;
    }
    setContent(parsed.content);
    setContentMeta(parsed.meta ? (parsed.meta as ContentMetaInput) : null);
    setJsonError(null);
    setJsonMode(false);
  };

  const handleToggleDiffMode = () => {
    setDiffMode((prev) => !prev);
    // Clear resolutions when exiting diff mode
    if (diffMode) {
      setResolvedDiffs(new Map());
    }
  };

  // Block-level diff resolution handler
  const handleResolveDiff = useCallback((entryIndex: number, action: DiffResolution) => {
    setResolvedDiffs((prev) => {
      const next = new Map(prev);
      next.set(entryIndex, action);
      return next;
    });
  }, []);

  // Document-level: accept all remaining unresolved as 'accept'
  const handleAcceptAllRemaining = useCallback(() => {
    setResolvedDiffs((prev) => {
      const next = new Map(prev);
      for (const { index } of changedEntries) {
        if (!next.has(index)) {
          next.set(index, "accept");
        }
      }
      return next;
    });
  }, [changedEntries]);

  // Apply resolved diffs to content
  const applyResolvedDiffs = useCallback(() => {
    const newBlocks: RawBlock[] = [];

    diffResult.entries.forEach((entry, index) => {
      const resolution = resolvedDiffs.get(index);

      if (entry.status === "unchanged") {
        // Unchanged blocks are always kept
        if (entry.original?.raw) {
          newBlocks.push(entry.original.raw);
        }
      } else if (entry.status === "removed") {
        // accept = delete, reject = keep
        if (resolution === "reject" && entry.original?.raw) {
          newBlocks.push(entry.original.raw);
        }
        // If accept or no resolution, the block is removed (not added to newBlocks)
      } else if (entry.status === "added") {
        // accept = keep, reject = delete
        if (resolution === "accept" && entry.edited?.raw) {
          newBlocks.push(entry.edited.raw);
        }
        // If reject or no resolution, the block is not added
      } else if (entry.status === "modified") {
        // accept = use new version, reject = use old version
        if (resolution === "accept" && entry.edited?.raw) {
          newBlocks.push(entry.edited.raw);
        } else if (entry.original?.raw) {
          newBlocks.push(entry.original.raw);
        }
      }
    });

    const newContent: JSONContent = { type: "doc", content: newBlocks as JSONContent[] };
    setContent(newContent);
    setBaselineContent(newContent);
    setDiffMode(false);
    setResolvedDiffs(new Map());
  }, [diffResult.entries, resolvedDiffs]);

  // Auto-prompt when all diffs are resolved
  const hasShownAllResolvedModal = useRef(false);
  
  useEffect(() => {
    // Reset the flag when entering diff mode or when resolutions change
    if (!diffMode || !allResolved) {
      hasShownAllResolvedModal.current = false;
      return;
    }

    // Only show modal once when all are resolved
    if (allResolved && !hasShownAllResolvedModal.current) {
      hasShownAllResolvedModal.current = true;
      Modal.confirm({
        title: "确认应用更改",
        content: `已解决所有 ${changedEntries.length} 处变更，是否应用并保存？`,
        okText: "确认保存",
        cancelText: "继续编辑",
        onOk: () => {
          applyResolvedDiffs();
          // Trigger save after a short delay to let state update
          setTimeout(() => {
            handleSave();
          }, 100);
        },
      });
    }
  }, [allResolved, diffMode, changedEntries.length, applyResolvedDiffs]);

  useEffect(() => {
    if (!diffMode) {
      return;
    }
    const changes = diffResult.entries
      .filter((entry) => entry.status !== "unchanged")
      .map((entry) => ({
        status: entry.status,
        blockId: entry.blockId,
        blockType: entry.blockType,
        fieldChanges: entry.fieldChanges,
      }));
    console.log("document_diff", {
      documentId,
      stats: diffResult.stats,
      changes,
    });
  }, [diffResult, diffMode, documentId]);

  return (
    <div className="new-doc-page">
      <div className="new-doc-header">
        <button className="btn primary" type="button" onClick={handleSave} disabled={saving}>
          {saving ? "保存中..." : "保存"}
        </button>
        <button
          className="btn ghost"
          type="button"
          onClick={handleToggleDiffMode}
          disabled={!baselineContent || Boolean(diffContentError)}
          title={diffContentError ?? ""}
        >
          {diffMode ? "Exit Diff" : "Diff"}
        </button>
        <button className="btn ghost" type="button" onClick={handleToggleJsonMode}>
          {jsonMode ? "Editor" : "JSON"}
        </button>
      </div>
      {saveError ? <div className="doc-viewer-error">{saveError}</div> : null}
      {loadingDocument ? (
        <div className="doc-viewer-state">加载文档中...</div>
      ) : null}
      {diffContentError ? <div className="doc-viewer-error">{diffContentError}</div> : null}
      <div className="new-doc-metadata">
        <input
          className="kb-title-input new-doc-title-input"
          type="text"
          value={title}
          placeholder="无标题文档"
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>
      <div className="new-doc-body">
        {diffMode ? (
          <div className="doc-diff-view">
            {/* Diff toolbar with progress and actions */}
            <div className="doc-diff-toolbar">
              <div className="doc-diff-progress">
                {changedEntries.length > 0 ? (
                  <span>已解决 {resolvedCount}/{changedEntries.length}</span>
                ) : (
                  <span>无变更</span>
                )}
              </div>
              <div className="doc-diff-toolbar-actions">
                <button
                  className="btn small primary"
                  type="button"
                  onClick={handleAcceptAllRemaining}
                  disabled={changedEntries.length === 0 || allResolved}
                >
                  接受全部变更
                </button>
                <button
                  className="btn small ghost"
                  type="button"
                  onClick={handleToggleDiffMode}
                >
                  退出 Diff
                </button>
              </div>
            </div>

            {/* Diff content */}
            <div className="doc-diff-content">
              {diffResult.entries.length === 0 ? (
                <div className="doc-viewer-state">No changes detected.</div>
              ) : (
                diffResult.entries.map((entry, index) => {
                  const originalDoc = entry.original ? wrapBlockInDoc(entry.original) : null;
                  const editedDoc = entry.edited ? wrapBlockInDoc(entry.edited) : null;
                  const isResolved = resolvedDiffs.has(index);
                  const resolution = resolvedDiffs.get(index);

                  return entry.status === "unchanged" ? (
                    <div key={`${entry.status}-${index}`} className="doc-diff-plain">
                      {originalDoc ? (
                        <RichTextViewer
                          content={originalDoc as JSONContent}
                          projectKey={currentProject?.key ?? ""}
                        />
                      ) : (
                        <div className="doc-viewer-state">No content</div>
                      )}
                    </div>
                  ) : (
                    <div
                      key={`${entry.status}-${index}`}
                      className={`doc-diff-block doc-diff-${entry.status}${isResolved ? " resolved" : ""}`}
                    >
                      <div className="doc-diff-label">
                        {getStatusLabel(entry.status)}
                        {isResolved && (
                          <span className="doc-diff-resolution-badge">
                            {resolution === "accept" ? "✓ 已接受" : "✗ 已拒绝"}
                          </span>
                        )}
                      </div>
                      <div className="doc-diff-change">
                        {entry.status === "modified" ? (
                          // Modified: show both versions with individual accept buttons
                          <>
                            {originalDoc && (
                              <div className={`doc-diff-change-item${resolution === "reject" ? " selected" : ""}`}>
                                <div className="doc-diff-change-header">
                                  <span className="doc-diff-change-title">原始版本</span>
                                  {!isResolved && (
                                    <button
                                      className="doc-diff-action-btn use"
                                      type="button"
                                      onClick={() => handleResolveDiff(index, "reject")}
                                    >
                                      采用此版本
                                    </button>
                                  )}
                                </div>
                                <RichTextViewer
                                  content={originalDoc as JSONContent}
                                  projectKey={currentProject?.key ?? ""}
                                />
                              </div>
                            )}
                            {editedDoc && (
                              <div className={`doc-diff-change-item${resolution === "accept" ? " selected" : ""}`}>
                                <div className="doc-diff-change-header">
                                  <span className="doc-diff-change-title">修改版本</span>
                                  {!isResolved && (
                                    <button
                                      className="doc-diff-action-btn use"
                                      type="button"
                                      onClick={() => handleResolveDiff(index, "accept")}
                                    >
                                      采用此版本
                                    </button>
                                  )}
                                </div>
                                <RichTextViewer
                                  content={editedDoc as JSONContent}
                                  projectKey={currentProject?.key ?? ""}
                                />
                              </div>
                            )}
                          </>
                        ) : (
                          // Added or Removed: show single content with accept/reject buttons
                          <>
                            {originalDoc && (
                              <div className="doc-diff-change-item">
                                <RichTextViewer
                                  content={originalDoc as JSONContent}
                                  projectKey={currentProject?.key ?? ""}
                                />
                              </div>
                            )}
                            {editedDoc && (
                              <div className="doc-diff-change-item">
                                <RichTextViewer
                                  content={editedDoc as JSONContent}
                                  projectKey={currentProject?.key ?? ""}
                                />
                              </div>
                            )}
                          </>
                        )}
                      </div>
                      {/* Hover action buttons for Added/Removed blocks */}
                      {entry.status !== "modified" && !isResolved && (
                        <div className="doc-diff-block-actions">
                          <button
                            className="doc-diff-action-btn accept"
                            type="button"
                            onClick={() => handleResolveDiff(index, "accept")}
                            title={entry.status === "removed" ? "确认删除" : "确认添加"}
                          >
                            {entry.status === "removed" ? "确认删除" : "确认添加"}
                          </button>
                          <button
                            className="doc-diff-action-btn reject"
                            type="button"
                            onClick={() => handleResolveDiff(index, "reject")}
                            title={entry.status === "removed" ? "保留原内容" : "取消添加"}
                          >
                            {entry.status === "removed" ? "保留" : "取消"}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ) : jsonMode ? (
          <div className="new-doc-json">
            <div className="new-doc-json-title">Document JSON</div>
            <textarea
              className="new-doc-json-editor"
              value={jsonDraft}
              onChange={(event) => setJsonDraft(event.target.value)}
              spellCheck={false}
            />
            {jsonError ? <div className="doc-viewer-error">{jsonError}</div> : null}
          </div>
        ) : (
          <div className="new-doc-editor">
            <RichTextEditor
              content={content}
              onChange={setContent}
              projectKey={currentProject?.key ?? ""}
              docId={documentIdParam || undefined}
              onLoadDocument={handleLoadDocument}
              onEditorReady={(editor) => setEditorReady(!!editor)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default NewDocumentPage;



type EditorMeta = {
  zeus?: boolean;
  format?: string;
  schema_version?: number;
  editor?: string;
  created_at?: string;
  updated_at?: string;
};

type EditorPayload = {
  meta?: EditorMeta;
  content?: JSONContent;
} & JSONContent;

const parseEditorPayload = (raw: string) => {
  if (!raw.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as EditorPayload;
    if (parsed.meta?.zeus && parsed.meta.format === "tiptap" && parsed.content) {
      return {
        meta: parsed.meta,
        content: parsed.content,
      };
    }
    if (parsed.type === "doc") {
      return {
        content: parsed,
      };
    }
    if (parsed.content?.type === "doc") {
      return {
        content: parsed.content,
      };
    }
    return null;
  } catch {
    return null;
  }
};

const parseContentJson = (raw: string) => {
  if (!raw.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as {
      meta?: EditorMeta;
      content?: JSONContent;
      type?: string;
    };
    if (parsed?.content && parsed.content.type === "doc") {
      return { meta: parsed.meta ?? null, content: parsed.content };
    }
    if (parsed?.type === "doc") {
      return { meta: null, content: parsed as JSONContent };
    }
    return null;
  } catch {
    return null;
  }
};
