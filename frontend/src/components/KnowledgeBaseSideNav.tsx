export type KnowledgeBaseDocument = {
  id: string;
  title: string;
  type: string;
  parentId: string;
  hasChild: boolean;
  order: number;
  storageObjectId: string;
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
}: KnowledgeBaseSideNavProps) {
  const renderTree = (docs: KnowledgeBaseDocument[], depth: number) => (
    <div className="kb-doc-group">
      {docs.map((doc) => {
        const isExpanded = Boolean(expandedIds[doc.id]);
        const children = isExpanded ? childrenByParent[doc.id] ?? [] : [];
        const isLoading = Boolean(loadingIds[doc.id]);
        return (
          <div key={doc.id} className="kb-doc-node">
            <div className="kb-doc-row">
              <div
                className={`kb-doc-control${activeId === doc.id ? " active" : ""}`}
                style={{ paddingLeft: `${8 + depth * 14}px` }}
              >
                {doc.hasChild ? (
                  <button
                    className="kb-doc-toggle"
                    type="button"
                    onClick={() => onToggle(doc)}
                    aria-label={isExpanded ? "Collapse" : "Expand"}
                  >
                    {isExpanded ? "v" : ">"}
                  </button>
                ) : (
                  <span className="kb-doc-dot" aria-hidden="true" />
                )}
                <button
                  className="kb-doc-item"
                  type="button"
                  onClick={() => onSelect(doc.id)}
                >
                  {doc.title || "Untitled"}
                </button>
              </div>
            </div>
            {isExpanded ? (
              <div className="kb-doc-children">
                {isLoading ? <div className="kb-doc-loading">Loading...</div> : null}
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
    <aside className="kb-sidebar">
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
