import { HashRouter, Route, Routes } from "react-router-dom";

import Sidebar from "./components/Sidebar";
import KnowledgeBasePage from "./pages/KnowledgeBasePage";
import "./App.css";

function App() {
  return (
    <HashRouter>
      <div className="app-shell">
        <header className="topbar">
          <div className="topbar-logo">Zeus</div>
          <nav className="topbar-menu">
            <button className="topbar-link" type="button">
              Overview
            </button>
            <button className="topbar-link" type="button">
              Documents
            </button>
            <button className="topbar-link" type="button">
              Pipeline
            </button>
            <button className="topbar-link" type="button">
              Settings
            </button>
          </nav>
        </header>
        <div className="app-body">
          <Sidebar />
          <main className="content">
            <div className="content-inner">
              <Routes>
                <Route path="/" element={<KnowledgeBasePage />} />
              </Routes>
            </div>
          </main>
        </div>
      </div>
    </HashRouter>
  );
}

export default App;
