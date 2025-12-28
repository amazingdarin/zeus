import type { ReactNode } from "react";

import Sidebar from "../components/Sidebar";

type AppShellProps = {
  children: ReactNode;
};

const navItems = [
  { label: "Knowledge Base", to: "/knowledge" },
  { label: "Uploads" },
  { label: "Classification" },
  { label: "Modules" },
  { label: "Audit Log" },
];

function AppShell({ children }: AppShellProps) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-logo">Zeus</div>
      </header>
      <div className="app-body">
        <Sidebar items={navItems} activeIndex={0} />
        <main className="content">{children}</main>
      </div>
    </div>
  );
}

export default AppShell;
