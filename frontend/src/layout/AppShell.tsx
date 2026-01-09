import { useState, type ReactNode } from "react";

import Sidebar from "../components/Sidebar";

type AppShellProps = {
  children: ReactNode;
};

const navItems = [
  { label: "Knowledge Base", to: "/knowledge", icon: "K" },
];

function AppShell({ children }: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-logo">Zeus</div>
      </header>
      <div className={`app-body${collapsed ? " compact" : ""}`}>
        <Sidebar
          items={navItems}
          activeIndex={0}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((prev) => !prev)}
        />
        <main className="content">{children}</main>
      </div>
    </div>
  );
}

export default AppShell;
