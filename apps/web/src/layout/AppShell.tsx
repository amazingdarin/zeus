import { useMemo, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { FileTextOutlined, RobotOutlined, LogoutOutlined, SettingOutlined } from "@ant-design/icons";
import { Avatar, Dropdown, Typography, message } from "antd";
import type { MenuProps } from "antd";

import Sidebar from "../components/Sidebar";
import SettingsModal from "../components/SettingsModal";
import ChatPanel from "../components/ChatPanel";
import { useAuth } from "../context/AuthContext";

const { Text } = Typography;

type AppShellProps = {
  children: ReactNode;
};

const navItems = [
  { label: "AI 助手", to: "/chat", icon: <RobotOutlined /> },
  { label: "文档", to: "/documents", icon: <FileTextOutlined /> },
];

function AppShell({ children }: AppShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { user, isAuthenticated, logout } = useAuth();

  const activeIndex = useMemo(() => {
    const path = location.pathname;
    const index = navItems.findIndex((item) => item.to && path.startsWith(item.to));
    return index === -1 ? -1 : index;
  }, [location.pathname]);

  // Don't show ChatPanel on the dedicated chat page
  const isChatPage = location.pathname === "/chat";

  const handleLogout = async () => {
    try {
      await logout();
      message.success('已退出登录');
      navigate('/login');
    } catch (error) {
      message.error('退出登录失败');
    }
  };

  const userMenuItems: MenuProps['items'] = [
    {
      key: 'user-info',
      label: (
        <div style={{ padding: '8px 0', minWidth: 180 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {user?.display_name || user?.username}
          </div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {user?.email}
          </Text>
        </div>
      ),
      disabled: true,
    },
    { type: 'divider' },
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: '设置',
      onClick: () => setSettingsOpen(true),
    },
    { type: 'divider' },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      onClick: handleLogout,
    },
  ];

  // Get initials for avatar
  const getInitials = () => {
    if (user?.display_name) {
      return user.display_name.charAt(0).toUpperCase();
    }
    if (user?.username) {
      return user.username.charAt(0).toUpperCase();
    }
    return 'U';
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-logo">Zeus</div>
        <div className="topbar-spacer" />
        {isAuthenticated && user && (
          <Dropdown 
            menu={{ items: userMenuItems }} 
            placement="bottomRight"
            trigger={['hover']}
          >
            <div className="topbar-user">
              {user.avatar_url ? (
                <Avatar src={user.avatar_url} size={32} />
              ) : (
                <Avatar 
                  size={32} 
                  style={{ 
                    backgroundColor: '#667eea',
                    cursor: 'pointer',
                  }}
                >
                  {getInitials()}
                </Avatar>
              )}
            </div>
          </Dropdown>
        )}
      </header>
      <div className="app-body compact">
        <Sidebar
          items={navItems}
          activeIndex={activeIndex}
          settingsActive={settingsOpen}
          onSettingsClick={() => setSettingsOpen(true)}
        />
        <main className="content">{children}</main>
      </div>

      {/* Bottom Chat Panel - hidden on dedicated chat page */}
      {!isChatPage && <ChatPanel onOpenSettings={() => setSettingsOpen(true)} />}

      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}

export default AppShell;
