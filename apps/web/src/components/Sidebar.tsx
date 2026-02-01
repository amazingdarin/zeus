import { Link } from "react-router-dom";
import { SettingOutlined, FileTextOutlined } from "@ant-design/icons";
import { Tooltip } from "antd";
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
  onSettingsClick?: () => void;
};

function Sidebar({
  items,
  activeIndex = 0,
  settingsActive = false,
  onSettingsClick,
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
              <Tooltip key={item.label} title={item.label} placement="right" mouseEnterDelay={0.3}>
                <Link className={className} to={item.to}>
                  {item.icon}
                </Link>
              </Tooltip>
            );
          }

          return (
            <Tooltip key={item.label} title={item.label} placement="right" mouseEnterDelay={0.3}>
              <button className={className} type="button">
                {item.icon}
              </button>
            </Tooltip>
          );
        })}
      </nav>
      <div className="sidebar-spacer" />
      <Tooltip title="设置" placement="right" mouseEnterDelay={0.3}>
        <button
          type="button"
          className={`sidebar-menu-item${settingsActive ? " active" : ""}`}
          onClick={onSettingsClick}
        >
          <SettingOutlined />
        </button>
      </Tooltip>
    </aside>
  );
}

export default Sidebar;

export { FileTextOutlined };
