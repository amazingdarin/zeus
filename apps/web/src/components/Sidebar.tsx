import { Link } from "react-router-dom";
import { SettingOutlined, FileTextOutlined, LogoutOutlined, TeamOutlined } from "@ant-design/icons";
import { Tooltip, Avatar, Dropdown, Typography } from "antd";
import type { MenuProps } from "antd";
import type { ReactNode } from "react";

import ProjectSelector from "./ProjectSelector";

const { Text } = Typography;

type SidebarItem = {
  label: string;
  to?: string;
  icon: ReactNode;
  onClick?: () => void;
};

type UserInfo = {
  username?: string;
  display_name?: string;
  email?: string;
  avatar_url?: string;
};

type SidebarProps = {
  items: SidebarItem[];
  activeIndex?: number;
  settingsActive?: boolean;
  onTeamsClick?: () => void;
  onSettingsClick?: () => void;
  onTutorialDocsClick?: () => void;
  user?: UserInfo | null;
  onLogout?: () => void;
};

function Sidebar({
  items,
  activeIndex = 0,
  settingsActive = false,
  onTeamsClick,
  onSettingsClick,
  onTutorialDocsClick,
  user,
  onLogout,
}: SidebarProps) {
  // Get initials for avatar
  const getInitials = () => {
    if (user?.display_name) {
      return user.display_name.charAt(0).toUpperCase();
    }
    if (user?.username) {
      return user.username.charAt(0).toUpperCase();
    }
    return "U";
  };

  const userMenuItems: MenuProps["items"] = user
    ? [
        {
          key: "user-info",
          label: (
            <div style={{ padding: "8px 0", minWidth: 180 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                {user.display_name || user.username}
              </div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {user.email}
              </Text>
            </div>
          ),
          disabled: true,
        },
        { type: "divider" as const },
        {
          key: "teams",
          icon: <TeamOutlined />,
          label: "团队",
          onClick: onTeamsClick,
        },
        {
          key: "settings",
          icon: <SettingOutlined />,
          label: "设置",
          onClick: onSettingsClick,
        },
        {
          key: "tutorial-docs",
          icon: <FileTextOutlined />,
          label: "教程说明",
          onClick: onTutorialDocsClick,
        },
        {
          key: "logout",
          icon: <LogoutOutlined />,
          label: "退出登录",
          onClick: onLogout,
        },
      ]
    : [];

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
              <button className={className} type="button" onClick={item.onClick}>
                {item.icon}
              </button>
            </Tooltip>
          );
        })}
      </nav>
      <div className="sidebar-spacer" />
      {user && (
        <Dropdown
          menu={{ items: userMenuItems }}
          placement="topRight"
          trigger={["click"]}
        >
          <div className="sidebar-user">
            <Tooltip title={user.display_name || user.username} placement="right" mouseEnterDelay={0.3}>
              {user.avatar_url ? (
                <Avatar src={user.avatar_url} size={32} style={{ cursor: "pointer" }} />
              ) : (
                <Avatar
                  size={32}
                  style={{
                    backgroundColor: "#667eea",
                    cursor: "pointer",
                  }}
                >
                  {getInitials()}
                </Avatar>
              )}
            </Tooltip>
          </div>
        </Dropdown>
      )}
    </aside>
  );
}

export default Sidebar;

export { FileTextOutlined };
