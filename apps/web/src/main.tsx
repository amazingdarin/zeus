import React from "react";
import ReactDOM from "react-dom/client";
import "antd/dist/reset.css";
import App from "./App";
import { initializeTheme } from "./context/ThemeContext";
import { PluginRuntimeProvider } from "./context/PluginRuntimeContext";

// Initialize theme before rendering to avoid flash
initializeTheme();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <PluginRuntimeProvider>
      <App />
    </PluginRuntimeProvider>
  </React.StrictMode>,
);
