import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import http from "node:http";
import https from "node:https";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// Pattern to match app-backend routes
const isAppBackendRoute = (url: string): boolean => {
  return (
    /^\/api\/projects\/[^/]+\/[^/]+\/[^/]+(?:\/|$)/.test(url) ||
    url.startsWith("/api/plugins/v2") ||
    url.startsWith("/api/system-docs") ||
    url.startsWith("/api/llm") ||
    url.startsWith("/api/ocr") ||
    url.startsWith("/api/skills") ||
    url.startsWith("/api/settings") ||
    url.startsWith("/api/app")
  );
};

function createApiProxyPlugin(apiTarget: string, appBackendTarget: string): Plugin {
  return {
    name: "api-proxy",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url || "";
        
        if (!url.startsWith("/api")) {
          return next();
        }

        // Determine target
        const isAppBackend = isAppBackendRoute(url);
        const targetUrl = new URL(isAppBackend ? appBackendTarget : apiTarget);
        
        // Rewrite path for /api/app
        let targetPath = url;
        if (url.startsWith("/api/app")) {
          targetPath = url.replace("/api/app", "/api");
        }

        // Create proxy request
        const options: http.RequestOptions = {
          hostname: targetUrl.hostname,
          port: targetUrl.port || (targetUrl.protocol === "https:" ? 443 : 80),
          path: targetPath,
          method: req.method,
          headers: {
            ...req.headers,
            host: targetUrl.host,
          },
        };

        const proxyReq = (targetUrl.protocol === "https:" ? https : http).request(
          options,
          (proxyRes) => {
            res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
            proxyRes.pipe(res, { end: true });
          }
        );

        proxyReq.on("error", (err) => {
          console.error("Proxy error:", err.message);
          res.writeHead(502);
          res.end("Bad Gateway");
        });

        req.pipe(proxyReq, { end: true });
      });
    },
  };
}

export default defineConfig(async ({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const serverTarget = (env.VITE_SERVER_URL ?? "http://localhost:8080").trim();
  const appBackendTarget = (env.VITE_APP_BACKEND_URL ?? "http://localhost:4870").trim();

  return {
    plugins: [
      react(),
      mode !== "production" && createApiProxyPlugin(serverTarget, appBackendTarget),
    ].filter(Boolean),
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
