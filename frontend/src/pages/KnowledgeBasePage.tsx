import KnowledgeBaseContent from "../components/KnowledgeBaseContent";
import KnowledgeBaseHeader from "../components/KnowledgeBaseHeader";
import KnowledgeBaseSidebar from "../components/KnowledgeBaseSidebar";

function KnowledgeBasePage() {
  return (
    <div className="kb-layout">
      <KnowledgeBaseSidebar />
      <section className="kb-main">
        <KnowledgeBaseHeader />
        <KnowledgeBaseContent />
      </section>
    </div>
  );
}

export default KnowledgeBasePage;
