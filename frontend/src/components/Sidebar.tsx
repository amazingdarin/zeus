import { Link } from "react-router-dom";

import ProjectSelector from "./ProjectSelector";

type SidebarItem = {
  label: string;
  to?: string;
  icon: string;
};

type SidebarProps = {
  items: SidebarItem[];
  activeIndex?: number;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
};

function Sidebar({
  items,
  activeIndex = 0,
  collapsed = false,
  onToggleCollapse,
}: SidebarProps) {
  return (
    <aside className={`sidebar${collapsed ? " compact" : ""}`}>
      <ProjectSelector collapsed={collapsed} />
      <div className={`sidebar-title-wrap${collapsed ? " compact" : ""}`}>
        <div className={`sidebar-title${collapsed ? " compact" : ""}`}>Workspace</div>
        {collapsed ? <div className="sidebar-divider" aria-hidden="true" /> : null}
      </div>
      <nav className="sidebar-nav">
        {items.map((item, index) => {
          const className = `sidebar-link${
            index === activeIndex ? " active" : ""
          }`;

          if (item.to) {
            return (
              <Link key={item.label} className={className} to={item.to}>
                <span className="sidebar-icon" aria-hidden="true">
                  {item.icon}
                </span>
                <span className="sidebar-label">{item.label}</span>
              </Link>
            );
          }

          return (
            <button key={item.label} className={className} type="button">
              <span className="sidebar-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span className="sidebar-label">{item.label}</span>
            </button>
          );
        })}
      </nav>
      <button
        className={`sidebar-toggle${collapsed ? " compact" : ""}`}
        type="button"
        onClick={onToggleCollapse}
        aria-label={collapsed ? "Expand menu" : "Collapse menu"}
      >
        {collapsed ? ">" : "<"}
      </button>
    </aside>
  );
}

export default Sidebar;
