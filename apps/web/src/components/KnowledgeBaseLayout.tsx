import type { ReactNode } from "react";

type KnowledgeBaseLayoutProps = {
  sideNav: ReactNode;
  children: ReactNode;
};

function KnowledgeBaseLayout({ sideNav, children }: KnowledgeBaseLayoutProps) {
  return (
    <div className="content-inner">
      <div className="kb-layout">
        {sideNav}
        <section className="kb-main">{children}</section>
      </div>
    </div>
  );
}

export default KnowledgeBaseLayout;
