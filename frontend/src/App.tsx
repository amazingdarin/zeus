import { useEffect } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";

import AppShell from "./layout/AppShell";
import KnowledgeBasePage from "./pages/KnowledgeBasePage";
import NewDocumentPage from "./pages/NewDocumentPage";
import { ProjectProvider } from "./context/ProjectContext";
import { ensureSystemSession } from "./config/api";
import "./App.css";

function App() {
  useEffect(() => {
    ensureSystemSession();
  }, []);

  return (
    <ProjectProvider>
      <HashRouter>
        <AppShell>
          <Routes>
            <Route path="/" element={<KnowledgeBasePage />} />
            <Route path="/knowledge" element={<KnowledgeBasePage />} />
            <Route path="/documents/new" element={<NewDocumentPage />} />
          </Routes>
        </AppShell>
      </HashRouter>
    </ProjectProvider>
  );
}

export default App;
