type DocumentTabBarItem = {
  docId: string;
  title: string;
  dirty?: boolean;
};

type DocumentTabBarProps = {
  tabs: DocumentTabBarItem[];
  activeDocId: string | null;
  onActivate: (docId: string) => void;
  onClose: (docId: string) => void;
};

export function toTabLabel(title: string): string {
  const trimmed = title.trim();
  return trimmed || "无标题文档";
}

export default function DocumentTabBar({
  tabs,
  activeDocId,
  onActivate,
  onClose,
}: DocumentTabBarProps) {
  return (
    <div className="doc-page-tabbar" role="tablist" aria-label="文档页签">
      {tabs.map((tab) => {
        const active = tab.docId === activeDocId;
        return (
          <button
            key={tab.docId}
            className={`doc-page-tab${active ? " active" : ""}`}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onActivate(tab.docId)}
            title={toTabLabel(tab.title)}
          >
            <span className="doc-page-tab-label">{toTabLabel(tab.title)}</span>
            {tab.dirty ? <span className="doc-page-tab-dirty" aria-hidden>•</span> : null}
            <span
              className="doc-page-tab-close"
              role="button"
              aria-label={`关闭 ${toTabLabel(tab.title)}`}
              onClick={(event) => {
                event.stopPropagation();
                onClose(tab.docId);
              }}
            >
              ×
            </span>
          </button>
        );
      })}
    </div>
  );
}
