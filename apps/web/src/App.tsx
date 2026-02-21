import { useEffect, useMemo, useState } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";

import AppShell from "./layout/AppShell";
import DocumentPage from "./pages/DocumentPage";
import NewDocumentPage from "./pages/NewDocumentPage";
import EduPluginPage from "./pages/EduPluginPage";
import ChatPage from "./pages/ChatPage";
import SystemDocsPage from "./pages/SystemDocsPage";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { InviteJoinPage } from "./pages/InviteJoinPage";
import { TeamsPage } from "./pages/TeamsPage";
import { TeamSettingsPage } from "./pages/TeamSettingsPage";
import { ProjectProvider } from "./context/ProjectContext";
import { AuthProvider } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { ensureSystemSession } from "./config/api";
import { usePluginRuntime, type PluginRouteEntry } from "./context/PluginRuntimeContext";
import "./App.css";

function PluginRouteContent({ route }: { route: PluginRouteEntry }) {
  const renderedContent = typeof route.render === "function"
    ? route.render()
    : (
      <div className="plugin-route-empty">
        <h2>{route.title || route.id}</h2>
        <p>插件页面已注册，但未提供前端渲染模块。</p>
      </div>
    );

  return (
    <div className="content-inner plugin-route-page">
      <div className="plugin-route-body">
        {renderedContent}
      </div>
    </div>
  );
}

function App() {
  const [sessionReady, setSessionReady] = useState(false);
  const { routes } = usePluginRuntime();

  const pluginRoutes = useMemo(() => {
    const seen = new Set<string>();
    const normalized: PluginRouteEntry[] = [];
    for (const route of routes) {
      const path = String(route.path || "").trim();
      if (!path || seen.has(path)) {
        continue;
      }
      seen.add(path);
      normalized.push(route);
    }
    return normalized;
  }, [routes]);

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
    <ThemeProvider>
      <AuthProvider>
        <ProjectProvider>
          <HashRouter>
            <Routes>
              {/* Public routes */}
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/invite/:token" element={<InviteJoinPage />} />

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
              <Route path="/edu" element={
                <ProtectedRoute>
                  <AppShell>
                    <EduPluginPage />
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
              <Route path="/system-docs" element={
                <ProtectedRoute>
                  <AppShell>
                    <SystemDocsPage />
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
              {pluginRoutes.map((route) => (
                <Route
                  key={`plugin-route-${route.pluginId}-${route.id}-${route.path}`}
                  path={route.path}
                  element={
                    <ProtectedRoute>
                      <AppShell>
                        <PluginRouteContent route={route} />
                      </AppShell>
                    </ProtectedRoute>
                  }
                />
              ))}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </HashRouter>
        </ProjectProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
