import { useEffect, useState } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";

import AppShell from "./layout/AppShell";
import DocumentPage from "./pages/DocumentPage";
import NewDocumentPage from "./pages/NewDocumentPage";
import ChatPage from "./pages/ChatPage";
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
            <Route path="/" element={<Navigate to="/documents" replace />} />
            <Route path="/documents" element={<DocumentPage />} />
            <Route path="/documents/:documentId" element={<DocumentPage />} />
            <Route path="/knowledge" element={<Navigate to="/documents" replace />} />
            <Route path="/documents/new" element={<NewDocumentPage />} />
            <Route path="/chat" element={<ChatPage />} />
          </Routes>
        </AppShell>
      </HashRouter>
    </ProjectProvider>
  );
}

export default App;
