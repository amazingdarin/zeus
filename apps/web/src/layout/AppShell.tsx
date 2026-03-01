import { useMemo, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AppstoreOutlined, BookOutlined, FileTextOutlined, RobotOutlined } from "@ant-design/icons";
import { message } from "antd";

import Sidebar from "../components/Sidebar";
import SettingsModal from "../components/SettingsModal";
import ChatPanel from "../components/ChatPanel";
import CommandPalette from "../components/CommandPalette";
import { useAuth } from "../context/AuthContext";
import { useProjectContext } from "../context/ProjectContext";
import { usePluginRuntime } from "../context/PluginRuntimeContext";

type AppShellProps = {
  children: ReactNode;
};

const coreNavItems = [
  { label: "AI 助手", to: "/chat", icon: <RobotOutlined /> },
  { label: "文档", to: "/documents", icon: <FileTextOutlined /> },
  { label: "Edu 题库", to: "/edu", icon: <BookOutlined /> },
];

function AppShell({ children }: AppShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { user, isAuthenticated, logout } = useAuth();
  const { currentProject } = useProjectContext();
  const { sidebarMenus, runMenuAction } = usePluginRuntime();

  const navItems = useMemo(() => {
    const pluginItems = sidebarMenus.map((menuItem) => ({
      label: menuItem.title,
      to: menuItem.route,
      icon: <AppstoreOutlined />,
      onClick: menuItem.route
        ? undefined
        : () => {
            void runMenuAction(menuItem).catch((err) => {
              const msg = err instanceof Error ? err.message : "插件菜单执行失败";
              message.error(msg);
            });
          },
    }));

    return [...coreNavItems, ...pluginItems];
  }, [sidebarMenus, runMenuAction]);

  const activeIndex = useMemo(() => {
    const path = location.pathname;
    const index = navItems.findIndex((item) => item.to && path.startsWith(item.to));
    return index === -1 ? -1 : index;
  }, [location.pathname]);

  const isDocumentPageRoute = useMemo(() => {
    if (location.pathname === "/documents") {
      return true;
    }
    if (location.pathname === "/documents/new") {
      return true;
    }
    return /^\/documents\/[^/]+$/.test(location.pathname);
  }, [location.pathname]);

  // Don't show ChatPanel on the dedicated chat page
  const isChatPage = location.pathname === "/chat";

  const handleLogout = async () => {
    try {
      await logout();
      message.success("已退出登录");
      navigate("/login");
    } catch (error) {
      message.error("退出登录失败");
    }
  };

  return (
    <div className="app-shell">
      <div className="app-body compact">
        <Sidebar
          items={navItems}
          activeIndex={activeIndex}
          settingsActive={settingsOpen}
          onLoginClick={() => {
            setSettingsOpen(false);
            navigate("/login");
          }}
          onTeamsClick={() => {
            setSettingsOpen(false);
            navigate("/teams");
          }}
          onSettingsClick={() => setSettingsOpen(true)}
          onTutorialDocsClick={() => {
            setSettingsOpen(false);
            navigate("/system-docs");
          }}
          user={isAuthenticated ? user : null}
          messageCenterProjectKey={currentProject?.projectRef ?? null}
          onLogout={handleLogout}
        />
        <main className={`content${isDocumentPageRoute ? " content--flush" : ""}`}>{children}</main>
      </div>

      {/* Bottom Chat Panel - hidden on dedicated chat page */}
      {!isChatPage && <ChatPanel onOpenSettings={() => setSettingsOpen(true)} />}

      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
      <CommandPalette />
    </div>
  );
}

export default AppShell;
