import express from "express";
import cors from "cors";

import { buildRouter } from "./router";

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

app.listen(port, () => {
  console.log(`[app-backend] listening on :${port}`);
});
