import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async ({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = (env.VITE_API_BASE_URL ?? "").trim();
  const appBackendTarget = (env.VITE_APP_BACKEND_URL ?? "").trim();
  const proxy: Record<string, any> = {};
  if (mode !== "production" && apiTarget) {
    proxy["/api"] = {
      target: apiTarget,
      changeOrigin: true,
      secure: false,
    };
  }
  if (mode !== "production" && appBackendTarget) {
    proxy["/api/app"] = {
      target: appBackendTarget,
      changeOrigin: true,
      secure: false,
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
