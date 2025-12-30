export type KnowledgeBaseDocument = {
  id: string;
  title: string;
  type: string;
  parentId: string;
  hasChild: boolean;
  order: number;
};

type KnowledgeBaseSideNavProps = {
  overviewDocs: KnowledgeBaseDocument[];
  moduleDocs: KnowledgeBaseDocument[];
  documentDocs: KnowledgeBaseDocument[];
  childrenByParent: Record<string, KnowledgeBaseDocument[]>;
  expandedIds: Record<string, boolean>;
  activeId: string | null;
  loadingIds: Record<string, boolean>;
  rootLoading: boolean;
  onSelect: (id: string) => void;
  onToggle: (doc: KnowledgeBaseDocument) => void;
};

function KnowledgeBaseSideNav({
  overviewDocs,
  moduleDocs,
  documentDocs,
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
            <div className="kb-doc-row" style={{ paddingLeft: `${depth * 14}px` }}>
              <button
                className={`kb-doc-item${activeId === doc.id ? " active" : ""}`}
                type="button"
                onClick={() => onSelect(doc.id)}
              >
                {doc.title || "Untitled"}
              </button>
              {doc.hasChild ? (
                <button
                  className="kb-doc-toggle"
                  type="button"
                  onClick={() => onToggle(doc)}
                  aria-label={isExpanded ? "Collapse" : "Expand"}
                >
                  {isExpanded ? "−" : "+"}
                </button>
              ) : null}
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

  const renderSection = (title: string, docs: KnowledgeBaseDocument[]) => (
    <div className="kb-nav-section">
      <div className="kb-nav-title">{title}</div>
      {rootLoading ? (
        <div className="kb-doc-loading">Loading...</div>
      ) : docs.length === 0 ? (
        <div className="kb-doc-empty">No items</div>
      ) : (
        renderTree(docs, 0)
      )}
    </div>
  );

  return (
    <aside className="kb-sidebar">
      {renderSection("Overview", overviewDocs)}
      {renderSection("Modules", moduleDocs)}
      {renderSection("Documents", documentDocs)}
    </aside>
  );
}

export default KnowledgeBaseSideNav;
