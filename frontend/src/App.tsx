import { HashRouter, Route, Routes } from "react-router-dom";

import AppShell from "./layout/AppShell";
import KnowledgeBasePage from "./pages/KnowledgeBasePage";
import "./App.css";

function App() {
  return (
    <HashRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<KnowledgeBasePage />} />
          <Route path="/knowledge" element={<KnowledgeBasePage />} />
        </Routes>
      </AppShell>
    </HashRouter>
  );
}

export default App;
