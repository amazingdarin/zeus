import { useState } from "react";

import KnowledgeBaseHeader from "../components/KnowledgeBaseHeader";
import KnowledgeBaseLayout from "../components/KnowledgeBaseLayout";
import RawDocumentListPage from "./RawDocumentListPage";

function KnowledgeBasePage() {
  const [activeNavId, setActiveNavId] = useState("overview");

  return (
    <KnowledgeBaseLayout
      activeNavId={activeNavId}
      onSelectNav={setActiveNavId}
    >
      <KnowledgeBaseHeader />
      <p className="content-subtitle">
        Placeholder view for the knowledge base workspace.
      </p>
      {activeNavId === "raw-documents" ? (
        <RawDocumentListPage />
      ) : (
        <div className="content-panel">
          <div>
            <div className="panel-title">Main content area</div>
            <p>
              This section will hold knowledge base summaries and review
              queues.
            </p>
          </div>
        </div>
      )}
    </KnowledgeBaseLayout>
  );
}

export default KnowledgeBasePage;
