type NavItem = {
  id: string;
  label: string;
};

type KnowledgeBaseSideNavProps = {
  activeId: string;
  onSelect: (id: string) => void;
};

const overviewItem: NavItem = { id: "overview", label: "Overview" };
const modulesItems: NavItem[] = [
  { id: "module-auth", label: "AUTH" },
  { id: "module-order", label: "ORDER" },
  { id: "module-payment", label: "PAYMENT" },
];
const documentsItems: NavItem[] = [
  { id: "raw-documents", label: "Raw Documents" },
];

function KnowledgeBaseSideNav({ activeId, onSelect }: KnowledgeBaseSideNavProps) {
  return (
    <aside className="kb-sidebar">
      <div className="kb-nav-section">
        <div className="kb-nav-title">Overview</div>
        <button
          className={`kb-nav-item${activeId === overviewItem.id ? " active" : ""}`}
          type="button"
          onClick={() => onSelect(overviewItem.id)}
        >
          {overviewItem.label}
        </button>
      </div>

      <div className="kb-nav-section">
        <div className="kb-nav-title">Modules</div>
        <div className="kb-nav-group">
          {modulesItems.map((item) => (
            <button
              key={item.id}
              className={`kb-nav-item${activeId === item.id ? " active" : ""}`}
              type="button"
              onClick={() => onSelect(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="kb-nav-section">
        <div className="kb-nav-title">Documents</div>
        <div className="kb-nav-group">
          {documentsItems.map((item) => (
            <button
              key={item.id}
              className={`kb-nav-item${activeId === item.id ? " active" : ""}`}
              type="button"
              onClick={() => onSelect(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}

export default KnowledgeBaseSideNav;
