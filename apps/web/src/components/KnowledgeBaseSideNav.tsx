import { useMemo, useState, memo, type DragEvent } from "react";
import { DownOutlined, RightOutlined, ReloadOutlined, DatabaseOutlined } from "@ant-design/icons";
import { Tooltip } from "antd";

export type KnowledgeBaseDocument = {
  id: string;
  title: string;
  type: string;
  parentId: string;
  kind?: string;
  hasChild: boolean;
  order: number;
  storageObjectId: string;
};

export type KnowledgeBaseMoveRequest = {
  docId: string;
  newParentId: string;
  beforeId: string;
  afterId: string;
  sourceParentId: string;
  targetParentId: string;
};

type RebuildProgress = {
  total: number;
  processed: number;
  status: string;
};

type KnowledgeBaseSideNavProps = {
  documents: KnowledgeBaseDocument[];
  childrenByParent: Record<string, KnowledgeBaseDocument[]>;
  expandedIds: Record<string, boolean>;
  activeId: string | null;
  loadingIds: Record<string, boolean>;
  rootLoading: boolean;
  rebuildingIndex?: boolean;
  rebuildProgress?: RebuildProgress | null;
  onSelect: (doc: KnowledgeBaseDocument) => void;
  onToggle: (doc: KnowledgeBaseDocument) => void;
  onMove: (request: KnowledgeBaseMoveRequest) => void;
  onRefresh?: () => void;
  onRebuildIndex?: () => void;
  onEmptyAreaClick?: () => void;
};

const KnowledgeBaseSideNav = memo(function KnowledgeBaseSideNav({
  documents,
  childrenByParent,
  expandedIds,
  activeId,
  loadingIds,
  rootLoading,
  rebuildingIndex,
  rebuildProgress,
  onSelect,
  onToggle,
  onMove,
  onRefresh,
  onRebuildIndex,
  onEmptyAreaClick,
}: KnowledgeBaseSideNavProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    position: "before" | "after" | "inside";
  } | null>(null);

  const docMap = useMemo(() => {
    const map = new Map<string, KnowledgeBaseDocument>();
    documents.forEach((doc) => map.set(doc.id, doc));
    Object.values(childrenByParent).forEach((children) => {
      children.forEach((doc) => map.set(doc.id, doc));
    });
    return map;
  }, [childrenByParent, documents]);

  const getSiblings = (parentId: string) => {
    if (isRootId(parentId)) {
      return documents;
    }
    return childrenByParent[parentId] ?? [];
  };

  const getDropPosition = (
    event: DragEvent<HTMLDivElement>,
  ): "before" | "after" | "inside" => {
    const rect = event.currentTarget.getBoundingClientRect();
    const offset = event.clientY - rect.top;
    const ratio = rect.height ? offset / rect.height : 0.5;
    if (ratio < 0.25) {
      return "before";
    }
    if (ratio > 0.75) {
      return "after";
    }
    return "inside";
  };

  const isDescendant = (ancestorId: string, candidateId: string): boolean => {
    if (!ancestorId || !candidateId || ancestorId === candidateId) {
      return false;
    }
    const queue: KnowledgeBaseDocument[] = [...(childrenByParent[ancestorId] ?? [])];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        continue;
      }
      if (current.id === candidateId) {
        return true;
      }
      const next = childrenByParent[current.id];
      if (next && next.length > 0) {
        queue.push(...next);
      }
    }
    return false;
  };

  const computeMoveRequest = (
    dragId: string,
    targetDoc: KnowledgeBaseDocument,
    position: "before" | "after" | "inside",
  ): KnowledgeBaseMoveRequest | null => {
    if (dragId === targetDoc.id) {
      return null;
    }
    const sourceDoc = docMap.get(dragId);
    if (!sourceDoc) {
      return null;
    }

    const targetParentId =
      position === "inside" ? targetDoc.id : normalizeParentId(targetDoc.parentId);
    if (position === "inside" && isDescendant(dragId, targetDoc.id)) {
      return null;
    }
    if (position !== "inside" && isDescendant(dragId, targetParentId)) {
      return null;
    }

    const siblings = getSiblings(targetParentId).filter(
      (doc) => doc.id !== dragId,
    );
    const targetIndex = siblings.findIndex((doc) => doc.id === targetDoc.id);
    const prev = targetIndex > 0 ? siblings[targetIndex - 1] : null;
    const next = targetIndex >= 0 && targetIndex + 1 < siblings.length
      ? siblings[targetIndex + 1]
      : null;

    let beforeId = "";
    let afterId = "";
    if (position === "before") {
      beforeId = targetDoc.id;
      afterId = prev?.id ?? "";
    } else if (position === "after") {
      afterId = targetDoc.id;
      beforeId = next?.id ?? "";
    }

    return {
      docId: dragId,
      newParentId: toApiParentId(targetParentId),
      beforeId,
      afterId,
      sourceParentId: normalizeParentId(sourceDoc.parentId),
      targetParentId,
    };
  };

  const handleDragStart = (
    event: DragEvent<HTMLDivElement>,
    doc: KnowledgeBaseDocument,
  ) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", doc.id);
    setDraggingId(doc.id);
  };

  const handleDragEnd = () => {
    setDraggingId(null);
    setDropTarget(null);
  };

  const handleDragOver = (
    event: DragEvent<HTMLDivElement>,
    doc: KnowledgeBaseDocument,
  ) => {
    if (!draggingId || draggingId === doc.id) {
      return;
    }
    event.preventDefault();
    const position = getDropPosition(event);
    setDropTarget({ id: doc.id, position });
  };

  const handleDrop = (
    event: DragEvent<HTMLDivElement>,
    doc: KnowledgeBaseDocument,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const dragId = draggingId ?? event.dataTransfer.getData("text/plain");
    if (!dragId) {
      return;
    }
    const position = getDropPosition(event);
    const payload = computeMoveRequest(dragId, doc, position);
    if (payload) {
      onMove(payload);
    }
    setDropTarget(null);
    setDraggingId(null);
  };

  const handleRootDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const dragId = draggingId ?? event.dataTransfer.getData("text/plain");
    if (!dragId) {
      return;
    }
    const sourceDoc = docMap.get(dragId);
    if (!sourceDoc) {
      return;
    }
    onMove({
      docId: dragId,
      newParentId: "root",
      beforeId: "",
      afterId: "",
      sourceParentId: normalizeParentId(sourceDoc.parentId),
      targetParentId: "",
    });
    setDropTarget(null);
    setDraggingId(null);
  };

  const renderTree = (docs: KnowledgeBaseDocument[], depth: number) => (
    <div className="kb-doc-group">
      {docs.map((doc) => {
        const childrenData = childrenByParent[doc.id] ?? [];
        const hasActualChildren = childrenData.length > 0;
        const isExpanded = Boolean(expandedIds[doc.id]) && hasActualChildren;
        const children = isExpanded ? childrenData : [];
        const isLoading = Boolean(loadingIds[doc.id]);
        const isDropTarget =
          dropTarget?.id === doc.id ? dropTarget.position : null;
        return (
          <div key={doc.id} className="kb-doc-node">
            <div className="kb-doc-row">
              <div
                className={`kb-doc-control${activeId === doc.id ? " active" : ""}${
                  isDropTarget ? ` drag-${isDropTarget}` : ""
                }`}
                style={{ paddingLeft: `${8 + depth * 14}px` }}
                draggable
                onDragStart={(event) => handleDragStart(event, doc)}
                onDragEnd={handleDragEnd}
                onDragOver={(event) => handleDragOver(event, doc)}
                onDrop={(event) => handleDrop(event, doc)}
              >
                <span className="kb-doc-action">
                  {hasActualChildren ? (
                    <button
                      className="kb-doc-toggle"
                      type="button"
                      onClick={() => onToggle(doc)}
                      aria-label={isExpanded ? "Collapse" : "Expand"}
                      draggable={false}
                    >
                      {isExpanded ? <DownOutlined /> : <RightOutlined />}
                    </button>
                  ) : (
                    <span className="kb-doc-dot" aria-hidden="true" />
                  )}
                </span>
                <button
                  className="kb-doc-item"
                  type="button"
                  onClick={() => onSelect(doc)}
                  draggable={false}
                >
                  {doc.title || "Untitled"}
                </button>
                {isLoading ? (
                  <span className="kb-doc-spinner" aria-hidden="true" />
                ) : null}
              </div>
            </div>
            {isExpanded && children.length > 0 ? (
              <div className="kb-doc-children">
                {renderTree(children, depth + 1)}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );

  return (
    <aside
      className="kb-sidebar"
      onDragOver={(event) => {
        if (!draggingId) {
          return;
        }
        event.preventDefault();
      }}
      onDrop={handleRootDrop}
    >
      <div className="kb-sidebar-toolbar">
        <div className="kb-sidebar-toolbar-spacer" />
        {onRebuildIndex && (
          <Tooltip 
            title={
              rebuildingIndex && rebuildProgress
                ? `重建中：${rebuildProgress.processed}/${rebuildProgress.total}`
                : "重建索引"
            }
          >
            <button
              className={`kb-sidebar-toolbar-btn${rebuildingIndex ? " rebuilding" : ""}`}
              type="button"
              onClick={onRebuildIndex}
              disabled={rebuildingIndex || rootLoading}
            >
              <DatabaseOutlined spin={rebuildingIndex} />
            </button>
          </Tooltip>
        )}
        {onRefresh && (
          <Tooltip title="刷新文档树">
            <button
              className="kb-sidebar-toolbar-btn"
              type="button"
              onClick={onRefresh}
              disabled={rootLoading}
            >
              <ReloadOutlined spin={rootLoading} />
            </button>
          </Tooltip>
        )}
      </div>
      <div
        className="kb-sidebar-content"
        onClick={(e) => {
          // Only trigger if clicking directly on the content area, not on documents
          if (e.target === e.currentTarget && onEmptyAreaClick) {
            onEmptyAreaClick();
          }
        }}
      >
        {rootLoading ? (
          <div className="kb-doc-loading">Loading...</div>
        ) : documents.length === 0 ? (
          <div 
            className="kb-doc-empty kb-doc-empty-clickable"
            onClick={() => onEmptyAreaClick?.()}
          >
            点击添加文档
          </div>
        ) : (
          <>
            {renderTree(documents, 0)}
            {/* Clickable empty area at the bottom */}
            <div 
              className="kb-sidebar-empty-area"
              onClick={() => onEmptyAreaClick?.()}
            />
          </>
        )}
      </div>
    </aside>
  );
});

export default KnowledgeBaseSideNav;

function isRootId(value: string): boolean {
  return value.trim() === "" || value.trim().toLowerCase() === "root";
}

function normalizeParentId(value: string): string {
  return isRootId(value) ? "" : value.trim();
}

function toApiParentId(value: string): string {
  return normalizeParentId(value) === "" ? "root" : value.trim();
}
