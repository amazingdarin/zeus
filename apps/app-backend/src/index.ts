import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";

import { initPool } from "./db/postgres.js";
import { buildRouter } from "./router.js";
import { skillRegistry, syncAnthropicSkillConfigs } from "./llm/skills/index.js";
import { agentSkillCatalog } from "./llm/agent/index.js";
import { pluginManagerV2 } from "./plugins-v2/index.js";
import { createMcpRouter, loadMcpServerConfig } from "./mcp/index.js";
import { startMessageCenterTimeoutMonitor } from "./services/message-center-store.js";
import { startDocumentTrashCleanupScheduler } from "./services/document-trash/scheduler.js";
import { localeMiddleware } from "./middleware/locale.js";
import { initAppI18nRuntime } from "./i18n/runtime.js";

const app = express();
const port = Number(process.env.APP_BACKEND_PORT ?? 4870);
const corsOrigin = (process.env.APP_BACKEND_CORS ?? "").trim();

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  const { method, url } = req;
  
  res.on("finish", () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const statusColor = status >= 500 ? "\x1b[31m" : status >= 400 ? "\x1b[33m" : "\x1b[32m";
    const reset = "\x1b[0m";
    console.log(`[api] ${method} ${url} ${statusColor}${status}${reset} ${duration}ms`);
  });
  
  next();
});

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(
  cors({
    origin: corsOrigin || true,
    credentials: true,
  }),
);
app.use(localeMiddleware);

const mcpConfig = loadMcpServerConfig();
if (mcpConfig.enabled) {
  app.use(mcpConfig.path, createMcpRouter(mcpConfig));
  console.log(`[app-backend] MCP server enabled at ${mcpConfig.path}`);
}

app.use("/api", buildRouter());

// Initialize database pool and start server
const start = async () => {
  let stopMessageCenterTimeoutMonitor: (() => void) | null = null;
  let stopTrashCleanupScheduler: (() => void) | null = null;
  try {
    await initAppI18nRuntime();
    console.log("[app-backend] i18n runtime initialized");
    await initPool();
    console.log("[app-backend] PostgreSQL pool initialized");
    const timeoutMs = Number(process.env.MESSAGE_CENTER_TASK_TIMEOUT_MS ?? 60 * 60 * 1000);
    const intervalMs = Number(process.env.MESSAGE_CENTER_TIMEOUT_SWEEP_INTERVAL_MS ?? 60 * 1000);
    stopMessageCenterTimeoutMonitor = startMessageCenterTimeoutMonitor({
      timeoutMs,
      intervalMs,
    });
    console.log(
      `[app-backend] Message center timeout monitor started (timeout=${timeoutMs}ms, interval=${intervalMs}ms)`,
    );
    const trashCleanupIntervalMs = Number(
      process.env.TRASH_CLEANUP_SWEEP_INTERVAL_MS ?? 60 * 60 * 1000,
    );
    stopTrashCleanupScheduler = startDocumentTrashCleanupScheduler({
      intervalMs: trashCleanupIntervalMs,
    });
    console.log(
      `[app-backend] Trash cleanup scheduler started (interval=${trashCleanupIntervalMs}ms)`,
    );
  } catch (err) {
    console.warn("[app-backend] PostgreSQL not available, knowledge indexing disabled:", err);
  }

  // Initialize skill registry (discover Anthropic Skills)
  try {
    await skillRegistry.initialize();
    const counts = skillRegistry.getCounts();
    console.log(`[app-backend] Skill registry initialized: ${counts.native} native, ${counts.anthropic} Anthropic skills`);

    // Sync Anthropic Skills enabled state from database
    await syncAnthropicSkillConfigs();

    // Initialize system-agent skill catalog (native + anthropic + mcp + plugin)
    await agentSkillCatalog.initialize();
    const agentCounts = agentSkillCatalog.getCounts();
    console.log(
      `[app-backend] Agent skill catalog initialized: ${agentCounts.native} native, ${agentCounts.anthropic} anthropic, ${agentCounts.mcp} mcp, ${agentCounts.plugin} plugin`,
    );
  } catch (err) {
    console.warn("[app-backend] Skill registry initialization failed:", err);
  }

  try {
    await pluginManagerV2.initialize();
    console.log("[app-backend] Plugin manager v2 initialized");
  } catch (err) {
    console.warn("[app-backend] Plugin manager v2 initialization failed:", err);
  }

  app.listen(port, () => {
    console.log(`[app-backend] listening on :${port}`);
  });

  const shutdown = () => {
    if (stopMessageCenterTimeoutMonitor) {
      stopMessageCenterTimeoutMonitor();
      stopMessageCenterTimeoutMonitor = null;
    }
    if (stopTrashCleanupScheduler) {
      stopTrashCleanupScheduler();
      stopTrashCleanupScheduler = null;
    }
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
};

start();
