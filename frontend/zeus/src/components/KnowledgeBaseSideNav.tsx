import { useMemo, useState, type DragEvent } from "react";
import { DownOutlined, RightOutlined } from "@ant-design/icons";

export type KnowledgeBaseDocument = {
  id: string;
  title: string;
  type: string;
  parentId: string;
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

type KnowledgeBaseSideNavProps = {
  documents: KnowledgeBaseDocument[];
  childrenByParent: Record<string, KnowledgeBaseDocument[]>;
  expandedIds: Record<string, boolean>;
  activeId: string | null;
  loadingIds: Record<string, boolean>;
  rootLoading: boolean;
  onSelect: (id: string) => void;
  onToggle: (doc: KnowledgeBaseDocument) => void;
  onMove: (request: KnowledgeBaseMoveRequest) => void;
};

function KnowledgeBaseSideNav({
  documents,
  childrenByParent,
  expandedIds,
  activeId,
  loadingIds,
  rootLoading,
  onSelect,
  onToggle,
  onMove,
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
        const isExpanded = Boolean(expandedIds[doc.id]);
        const children = isExpanded ? childrenByParent[doc.id] ?? [] : [];
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
                  {doc.hasChild ? (
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
                  onClick={() => onSelect(doc.id)}
                  draggable={false}
                >
                  {doc.title || "Untitled"}
                </button>
                {isLoading ? (
                  <span className="kb-doc-spinner" aria-hidden="true" />
                ) : null}
              </div>
            </div>
            {isExpanded ? (
              <div className="kb-doc-children">
                {!isLoading && children.length === 0 ? (
                  <div className="kb-doc-empty">No items</div>
                ) : null}
                {children.length > 0 ? renderTree(children, depth + 1) : null}
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
      {rootLoading ? (
        <div className="kb-doc-loading">Loading...</div>
      ) : documents.length === 0 ? (
        <div className="kb-doc-empty">No items</div>
      ) : (
        renderTree(documents, 0)
      )}
    </aside>
  );
}

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
