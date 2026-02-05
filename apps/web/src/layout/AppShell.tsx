import { useMemo, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { FileTextOutlined, RobotOutlined } from "@ant-design/icons";
import { message } from "antd";

import Sidebar from "../components/Sidebar";
import SettingsModal from "../components/SettingsModal";
import ChatPanel from "../components/ChatPanel";
import { useAuth } from "../context/AuthContext";

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

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-logo">Zeus</div>
        <div className="topbar-spacer" />
      </header>
      <div className="app-body compact">
        <Sidebar
          items={navItems}
          activeIndex={activeIndex}
          settingsActive={settingsOpen}
          onSettingsClick={() => setSettingsOpen(true)}
          user={isAuthenticated ? user : null}
          onLogout={handleLogout}
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
