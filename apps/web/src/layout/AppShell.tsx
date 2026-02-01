import { useMemo, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { FileTextOutlined } from "@ant-design/icons";

import Sidebar from "../components/Sidebar";
import SettingsModal from "../components/SettingsModal";
import ChatPanel from "../components/ChatPanel";

type AppShellProps = {
  children: ReactNode;
};

const navItems = [
  { label: "文档", to: "/documents", icon: <FileTextOutlined /> },
];

function AppShell({ children }: AppShellProps) {
  const location = useLocation();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const activeIndex = useMemo(() => {
    const path = location.pathname;
    const index = navItems.findIndex((item) => item.to && path.startsWith(item.to));
    return index === -1 ? -1 : index;
  }, [location.pathname]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-logo">Zeus</div>
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

      {/* Bottom Chat Panel */}
      <ChatPanel onOpenSettings={() => setSettingsOpen(true)} />

      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}

export default AppShell;
