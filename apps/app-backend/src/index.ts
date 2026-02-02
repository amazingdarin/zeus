import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";

import { initPool } from "./db/postgres.js";
import { buildRouter } from "./router.js";
import { skillRegistry, syncAnthropicSkillConfigs } from "./llm/skills/index.js";

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

app.use("/api", buildRouter());

// Initialize database pool and start server
const start = async () => {
  try {
    await initPool();
    console.log("[app-backend] PostgreSQL pool initialized");
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
  } catch (err) {
    console.warn("[app-backend] Skill registry initialization failed:", err);
  }

  app.listen(port, () => {
    console.log(`[app-backend] listening on :${port}`);
  });
};

start();
