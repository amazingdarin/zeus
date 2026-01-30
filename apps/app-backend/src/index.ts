import express from "express";
import cors from "cors";

import { initPool } from "./db/postgres.js";
import { buildRouter } from "./router.js";

const app = express();
const port = Number(process.env.APP_BACKEND_PORT ?? 4870);
const corsOrigin = (process.env.APP_BACKEND_CORS ?? "").trim();

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

  app.listen(port, () => {
    console.log(`[app-backend] listening on :${port}`);
  });
};

start();
