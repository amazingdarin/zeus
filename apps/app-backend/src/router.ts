import { Router } from "express";
import multer from "multer";

import { convertDocument } from "./services/convert";
import { fetchUrl } from "./services/fetch-url";
import { importGit } from "./services/import-git";

const upload = multer({ storage: multer.memoryStorage() });

export const buildRouter = () => {
  const router = Router();

  router.post("/projects/:projectKey/convert", upload.single("file"), async (req, res) => {
    try {
      const { projectKey } = req.params;
      const from = String(req.query.from ?? "");
      const to = String(req.query.to ?? "");
      if (!req.file) {
        res.status(400).json({ code: "INVALID_REQUEST", message: "file is required" });
        return;
      }
      const result = await convertDocument(projectKey, req.file, from, to);
      res.json({ code: "OK", message: "success", data: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Convert failed";
      res.status(400).json({ code: "CONVERT_FAILED", message });
    }
  });

  router.post("/projects/:projectKey/documents/fetch-url", async (req, res) => {
    try {
      const { projectKey } = req.params;
      const url = String(req.body?.url ?? "");
      const result = await fetchUrl(projectKey, url);
      res.json({ code: "OK", message: "success", data: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Fetch failed";
      res.status(400).json({ code: "FETCH_FAILED", message });
    }
  });

  router.post("/projects/:projectKey/documents/import-git", async (req, res) => {
    try {
      const { projectKey } = req.params;
      const result = await importGit(projectKey, req.body ?? {});
      res.json({ code: "OK", message: "success", data: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Import failed";
      res.status(400).json({ code: "IMPORT_FAILED", message });
    }
  });

  router.post("/projects/:projectKey/documents/import", upload.single("file"), async (req, res) => {
    try {
      const { projectKey } = req.params;
      const file = req.file;
      if (!file) {
        res.status(400).json({ code: "INVALID_REQUEST", message: "file is required" });
        return;
      }
      const sourceType = String(req.body?.source_type ?? "").trim().toLowerCase();
      const from = sourceType || file.originalname.split(".").pop() || "";
      const converted = await convertDocument(projectKey, file, from, "markdown");
      res.json({ code: "OK", message: "success", data: converted });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Import failed";
      res.status(400).json({ code: "IMPORT_FAILED", message });
    }
  });

  return router;
};
