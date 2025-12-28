type KnowledgeBaseHeaderProps = {
  title?: string;
};

function KnowledgeBaseHeader({ title = "Knowledge Base" }: KnowledgeBaseHeaderProps) {
  return (
    <div className="kb-main-header">
      <div className="kb-breadcrumb">{title}</div>
      <button className="btn icon" type="button" aria-label="Add item">
        +
      </button>
    </div>
  );
}

export default KnowledgeBaseHeader;
