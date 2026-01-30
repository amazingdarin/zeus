import { Link } from "react-router-dom";
import { LeftOutlined, RightOutlined, SettingOutlined } from "@ant-design/icons";

import ProjectSelector from "./ProjectSelector";

type SidebarItem = {
  label: string;
  to?: string;
  icon: string;
};

type SidebarProps = {
  items: SidebarItem[];
  activeIndex?: number;
  settingsActive?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
};

function Sidebar({
  items,
  activeIndex = 0,
  settingsActive = false,
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
      <Link
        className={`sidebar-config${settingsActive ? " active" : ""}`}
        to="/settings/providers"
      >
        <SettingOutlined />
        <span className="sidebar-label">Settings</span>
      </Link>
      <button
        className={`sidebar-toggle${collapsed ? " compact" : ""}`}
        type="button"
        onClick={onToggleCollapse}
        aria-label={collapsed ? "Expand menu" : "Collapse menu"}
      >
        {collapsed ? <RightOutlined /> : <LeftOutlined />}
      </button>
    </aside>
  );
}

export default Sidebar;
