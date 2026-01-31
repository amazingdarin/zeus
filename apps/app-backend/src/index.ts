import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import { spawn, type ChildProcess } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

import { initPool } from "./db/postgres.js";
import { buildRouter } from "./router.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.APP_BACKEND_PORT ?? 4870);
const corsOrigin = (process.env.APP_BACKEND_CORS ?? "").trim();

// PaddleOCR configuration
const enablePaddleOCR = process.env.ENABLE_PADDLE_OCR === "true";
const paddleOCRPort = Number(process.env.PADDLE_OCR_PORT ?? 8001);
const paddleOCRUrl = process.env.PADDLE_OCR_URL || `http://localhost:${paddleOCRPort}`;

let paddleOCRProcess: ChildProcess | null = null;

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

/**
 * Start PaddleOCR Python service as a child process
 */
function startPaddleOCR(): void {
  // Path to the PaddleOCR server script
  const scriptsDir = path.resolve(__dirname, "../../../scripts/ocr");
  const serverScript = path.join(scriptsDir, "paddleocr_server.py");

  console.log(`[app-backend] Starting PaddleOCR service on port ${paddleOCRPort}...`);

  paddleOCRProcess = spawn("python3", [serverScript, "--port", String(paddleOCRPort)], {
    cwd: scriptsDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PYTHONUNBUFFERED: "1", // Ensure Python output is not buffered
    },
  });

  paddleOCRProcess.stdout?.on("data", (data: Buffer) => {
    const lines = data.toString().trim().split("\n");
    for (const line of lines) {
      console.log(`[PaddleOCR] ${line}`);
    }
  });

  paddleOCRProcess.stderr?.on("data", (data: Buffer) => {
    const lines = data.toString().trim().split("\n");
    for (const line of lines) {
      // Filter out common uvicorn info messages that go to stderr
      if (line.includes("INFO:") || line.includes("Uvicorn running")) {
        console.log(`[PaddleOCR] ${line}`);
      } else {
        console.error(`[PaddleOCR] ${line}`);
      }
    }
  });

  paddleOCRProcess.on("error", (err) => {
    console.error(`[app-backend] Failed to start PaddleOCR service:`, err.message);
    console.error(`[app-backend] Make sure Python3 and PaddleOCR dependencies are installed.`);
    console.error(`[app-backend] See scripts/ocr/README.md for installation instructions.`);
    paddleOCRProcess = null;
  });

  paddleOCRProcess.on("exit", (code, signal) => {
    if (code !== null && code !== 0) {
      console.error(`[app-backend] PaddleOCR service exited with code ${code}`);
    } else if (signal) {
      console.log(`[app-backend] PaddleOCR service killed with signal ${signal}`);
    }
    paddleOCRProcess = null;
  });
}

/**
 * Stop PaddleOCR service
 */
function stopPaddleOCR(): void {
  if (paddleOCRProcess) {
    console.log("[app-backend] Stopping PaddleOCR service...");
    paddleOCRProcess.kill("SIGTERM");
    paddleOCRProcess = null;
  }
}

// Handle process termination
process.on("SIGINT", () => {
  stopPaddleOCR();
  process.exit(0);
});

process.on("SIGTERM", () => {
  stopPaddleOCR();
  process.exit(0);
});

// Initialize database pool and start server
const start = async () => {
  try {
    await initPool();
    console.log("[app-backend] PostgreSQL pool initialized");
  } catch (err) {
    console.warn("[app-backend] PostgreSQL not available, knowledge indexing disabled:", err);
  }

  // Start PaddleOCR service if enabled
  if (enablePaddleOCR) {
    console.log(`[app-backend] PaddleOCR enabled, URL: ${paddleOCRUrl}`);
    startPaddleOCR();
  } else {
    console.log("[app-backend] PaddleOCR disabled (set ENABLE_PADDLE_OCR=true to enable)");
  }

  app.listen(port, () => {
    console.log(`[app-backend] listening on :${port}`);
  });
};

start();
