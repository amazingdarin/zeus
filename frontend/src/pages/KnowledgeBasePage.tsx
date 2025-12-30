import { useEffect, useState } from "react";

import KnowledgeBaseHeader from "../components/KnowledgeBaseHeader";
import KnowledgeBaseLayout from "../components/KnowledgeBaseLayout";
import RawDocumentListPage from "./RawDocumentListPage";
import { useProjectContext } from "../context/ProjectContext";

function KnowledgeBasePage() {
  const [activeNavId, setActiveNavId] = useState("overview");
  const { currentProject } = useProjectContext();

  useEffect(() => {
    if (!currentProject) {
      return;
    }
    console.log("knowledge_base_reload", currentProject.key);
  }, [currentProject]);

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
