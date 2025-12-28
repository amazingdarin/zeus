import type { ReactNode } from "react";

import KnowledgeBaseSideNav from "./KnowledgeBaseSideNav";

type KnowledgeBaseLayoutProps = {
  activeNavId: string;
  onSelectNav: (id: string) => void;
  children: ReactNode;
};

function KnowledgeBaseLayout({
  activeNavId,
  onSelectNav,
  children,
}: KnowledgeBaseLayoutProps) {
  return (
    <div className="content-inner">
      <div className="kb-layout">
        <KnowledgeBaseSideNav activeId={activeNavId} onSelect={onSelectNav} />
        <section className="kb-main">{children}</section>
      </div>
    </div>
  );
}

export default KnowledgeBaseLayout;
