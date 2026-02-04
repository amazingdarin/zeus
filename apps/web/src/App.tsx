import { useEffect, useState } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";

import AppShell from "./layout/AppShell";
import DocumentPage from "./pages/DocumentPage";
import NewDocumentPage from "./pages/NewDocumentPage";
import ChatPage from "./pages/ChatPage";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { TeamsPage } from "./pages/TeamsPage";
import { TeamSettingsPage } from "./pages/TeamSettingsPage";
import { ProjectProvider } from "./context/ProjectContext";
import { AuthProvider } from "./context/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
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
    <AuthProvider>
      <ProjectProvider>
        <HashRouter>
          <Routes>
            {/* Public routes */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            
            {/* Protected routes */}
            <Route path="/" element={
              <ProtectedRoute>
                <AppShell>
                  <Navigate to="/documents" replace />
                </AppShell>
              </ProtectedRoute>
            } />
            <Route path="/documents" element={
              <ProtectedRoute>
                <AppShell>
                  <DocumentPage />
                </AppShell>
              </ProtectedRoute>
            } />
            <Route path="/documents/:documentId" element={
              <ProtectedRoute>
                <AppShell>
                  <DocumentPage />
                </AppShell>
              </ProtectedRoute>
            } />
            <Route path="/knowledge" element={
              <ProtectedRoute>
                <AppShell>
                  <Navigate to="/documents" replace />
                </AppShell>
              </ProtectedRoute>
            } />
            <Route path="/documents/new" element={
              <ProtectedRoute>
                <AppShell>
                  <NewDocumentPage />
                </AppShell>
              </ProtectedRoute>
            } />
            <Route path="/chat" element={
              <ProtectedRoute>
                <AppShell>
                  <ChatPage />
                </AppShell>
              </ProtectedRoute>
            } />
            <Route path="/teams" element={
              <ProtectedRoute>
                <AppShell>
                  <TeamsPage />
                </AppShell>
              </ProtectedRoute>
            } />
            <Route path="/teams/:slug" element={
              <ProtectedRoute>
                <AppShell>
                  <TeamSettingsPage />
                </AppShell>
              </ProtectedRoute>
            } />
            <Route path="/teams/:slug/settings" element={
              <ProtectedRoute>
                <AppShell>
                  <TeamSettingsPage />
                </AppShell>
              </ProtectedRoute>
            } />
          </Routes>
        </HashRouter>
      </ProjectProvider>
    </AuthProvider>
  );
}

export default App;
