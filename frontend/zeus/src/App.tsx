import { useEffect, useState } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";

import AppShell from "./layout/AppShell";
import KnowledgeBasePage from "./pages/KnowledgeBasePage";
import NewDocumentPage from "./pages/NewDocumentPage";
import SettingsPage from "./pages/SettingsPage";
import { ProjectProvider } from "./context/ProjectContext";
import { ensureSystemSession } from "./config/api";
import "./App.css";

function App() {
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    ensureSystemSession()
      .catch(() => undefined)
      .finally(() => {
        if (mounted) {
          setSessionReady(true);
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  if (!sessionReady) {
    return null;
  }

  return (
    <ProjectProvider>
      <HashRouter>
        <AppShell>
          <Routes>
            <Route path="/" element={<KnowledgeBasePage />} />
            <Route path="/documents" element={<KnowledgeBasePage />} />
            <Route path="/knowledge" element={<KnowledgeBasePage />} />
            <Route path="/documents/new" element={<NewDocumentPage />} />
            <Route path="/settings/providers" element={<SettingsPage />} />
          </Routes>
        </AppShell>
      </HashRouter>
    </ProjectProvider>
  );
}

export default App;
