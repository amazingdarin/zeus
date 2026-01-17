const modules = ["AUTH", "ORDER", "PAYMENT", "CATALOG", "PROFILE"];

function KnowledgeBaseSidebar() {
  return (
    <aside className="kb-sidebar">
      <div className="kb-sidebar-title">Modules</div>
      <div className="kb-module-list">
        {modules.map((module, index) => (
          <button
            key={module}
            className={`kb-module-item${index === 0 ? " active" : ""}`}
            type="button"
          >
            {module}
          </button>
        ))}
      </div>
    </aside>
  );
}

export default KnowledgeBaseSidebar;
