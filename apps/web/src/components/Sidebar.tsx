import { Link } from "react-router-dom";
import { SettingOutlined, FileTextOutlined } from "@ant-design/icons";
import type { ReactNode } from "react";

import ProjectSelector from "./ProjectSelector";

type SidebarItem = {
  label: string;
  to?: string;
  icon: ReactNode;
};

type SidebarProps = {
  items: SidebarItem[];
  activeIndex?: number;
  settingsActive?: boolean;
};

function Sidebar({
  items,
  activeIndex = 0,
  settingsActive = false,
}: SidebarProps) {
  return (
    <aside className="sidebar compact">
      <ProjectSelector collapsed={true} />
      <nav className="sidebar-nav">
        {items.map((item, index) => {
          const className = `sidebar-menu-item${
            index === activeIndex ? " active" : ""
          }`;

          if (item.to) {
            return (
              <Link key={item.label} className={className} to={item.to} title={item.label}>
                {item.icon}
              </Link>
            );
          }

          return (
            <button key={item.label} className={className} type="button" title={item.label}>
              {item.icon}
            </button>
          );
        })}
      </nav>
      <div className="sidebar-spacer" />
      <Link
        className={`sidebar-menu-item${settingsActive ? " active" : ""}`}
        to="/settings/providers"
        title="Settings"
      >
        <SettingOutlined />
      </Link>
    </aside>
  );
}

export default Sidebar;

export { FileTextOutlined };
