import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async ({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = (env.VITE_API_BASE_URL ?? "http://localhost:8080").trim();
  const appBackendTarget = (env.VITE_APP_BACKEND_URL ?? "http://localhost:4870").trim();
  const proxy: Record<string, any> = {};

  if (mode !== "production") {
    // App-backend handles document, knowledge, and asset APIs
    const appBackendRoutes = [
      "/api/projects/:projectKey/documents",
      "/api/projects/:projectKey/knowledge",
      "/api/projects/:projectKey/assets",
      "/api/app",
    ];

    // Custom proxy matcher for app-backend routes
    proxy["/api"] = {
      target: apiTarget,
      changeOrigin: true,
      secure: false,
      configure: (proxyInstance: any) => {
        proxyInstance.on("proxyReq", (proxyReq: any, req: any) => {
          const url = req.url || "";
          // Route document, knowledge, asset APIs to app-backend
          if (
            url.match(/^\/api\/projects\/[^/]+\/documents/) ||
            url.match(/^\/api\/projects\/[^/]+\/knowledge/) ||
            url.match(/^\/api\/projects\/[^/]+\/assets/) ||
            url.startsWith("/api/app")
          ) {
            const appUrl = url.startsWith("/api/app")
              ? url.replace("/api/app", "/api")
              : url;
            proxyReq.path = appUrl;
            proxyReq.setHeader("host", new URL(appBackendTarget).host);
          }
        });
      },
      router: (req: any) => {
        const url = req.url || "";
        if (
          url.match(/^\/api\/projects\/[^/]+\/documents/) ||
          url.match(/^\/api\/projects\/[^/]+\/knowledge/) ||
          url.match(/^\/api\/projects\/[^/]+\/assets/) ||
          url.startsWith("/api/app")
        ) {
          return appBackendTarget;
        }
        return apiTarget;
      },
    };
  }

  return {
    plugins: [react()],
    clearScreen: false,
    server: {
      port: 1420,
      strictPort: true,
      host: host || false,
      hmr: host
        ? {
            protocol: "ws",
            host,
            port: 1421,
          }
        : undefined,
      proxy,
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    root: path.resolve(__dirname),
    publicDir: path.resolve(__dirname, "./public"),
  };
});
