import { v4 as uuidv4 } from "uuid";
import type { JSONContent } from "@tiptap/core";

import { assetStore } from "../storage/asset-store.js";
import { documentStore } from "../storage/document-store.js";
import type { Document } from "../storage/types.js";
import { knowledgeSearch } from "../knowledge/search.js";
import { traceManager, type TraceContext } from "../observability/index.js";
import type { SmartImportMode, SmartImportType } from "./smart-import-types.js";
import { runSmartImportGraph } from "./smart-import-graph.js";
import {
  guessMime,
  normalizeParentId,
  normalizeTypes,
  smartTypeForFile,
  stripExtension,
} from "./smart-import-shared.js";

export type { SmartImportMode, SmartImportType } from "./smart-import-types.js";

export type ImportFileInput = {
  parentId: string;
  title?: string;
  file: {
    buffer: Buffer;
    originalname: string;
    mimetype?: string;
    size?: number;
  };
  smartImport?: boolean;
  smartImportTypes?: SmartImportType[];
  enableFormatOptimize?: boolean;
  traceContext?: TraceContext;
  traceMetadata?: Record<string, unknown>;
};

export type ImportAssetInput = {
  assetId: string;
  parentId: string;
  title?: string;
  smartImport?: boolean;
  smartImportTypes?: SmartImportType[];
  enableFormatOptimize?: boolean;
  traceContext?: TraceContext;
  traceMetadata?: Record<string, unknown>;
};

export type ImportFileResult = {
  docId: string;
  title: string;
  mode: SmartImportMode;
};

function buildDocument(input: {
  parentId: string;
  title: string;
  content: JSONContent;
}): Document {
  return {
    meta: {
      id: uuidv4(),
      schema_version: "v1",
      title: input.title,
      slug: "",
      path: "",
      parent_id: input.parentId,
      created_at: "",
      updated_at: "",
      extra: {
        status: "draft",
        tags: [],
      },
    },
    body: {
      type: "tiptap",
      content: input.content,
    },
  };
}

async function saveAndIndex(
  userId: string,
  projectKey: string,
  doc: Document,
): Promise<Document> {
  const saved = await documentStore.save(userId, projectKey, doc);
  knowledgeSearch.indexDocument(userId, projectKey, saved).catch((err) => {
    console.error("Index error:", err);
  });
  return saved;
}

/**
 * Import a single file as a Zeus document.
 *
 * Behavior:
 * - Always uploads the file as an asset and inserts a top block (image or file_block)
 * - When smart import is enabled and the file type is selected:
 *   - markdown: parse markdown into tiptap
 *   - word/pdf: convert to markdown (optionally optimize), then parse into tiptap
 *   - image: OCR into tiptap, appended after the image block
 * - If smart extraction or validation fails, falls back to asset-only document (still succeeds).
 */
export async function importFileAsDocument(
  userId: string,
  projectKey: string,
  input: ImportFileInput,
): Promise<ImportFileResult> {
  const parentId = normalizeParentId(input.parentId);
  const safeTitle = (input.title ?? "").trim();
  const filenameRaw = String(input.file.originalname ?? "").trim() || safeTitle || "Untitled";
  const title = safeTitle || stripExtension(filenameRaw) || "Untitled";
  const mime = guessMime(filenameRaw, input.file.mimetype);
  const size = Number(input.file.size ?? input.file.buffer.length ?? 0);
  const traceContext = input.traceContext;
  const traceMetadata = input.traceMetadata ?? {};

  const span = traceContext
    ? traceManager.startSpan(traceContext, "smart-import", {
        filename: filenameRaw,
        mime,
        size,
        parentId,
        smartImport: input.smartImport === true,
        smartType: smartTypeForFile(filenameRaw, mime),
        enableFormatOptimize: input.enableFormatOptimize === true,
        ...traceMetadata,
      })
    : null;
  const startedAt = Date.now();

  try {
    // Upload as asset first so the document can reference it.
    const asset = await assetStore.save(userId, projectKey, filenameRaw, mime, input.file.buffer);
    const assetMeta = {
      id: asset.id,
      filename: asset.filename,
      mime: guessMime(asset.filename, asset.mime),
      size: asset.size,
    };

    const types = normalizeTypes(input.smartImportTypes);
    const graph = await runSmartImportGraph({
      userId,
      projectKey,
      title,
      parentId,
      file: {
        buffer: input.file.buffer,
        originalname: filenameRaw,
        mimetype: mime,
        size,
      },
      assetMeta,
      smartImport: input.smartImport === true,
      smartImportTypes: Array.from(types),
      enableFormatOptimize: input.enableFormatOptimize === true,
      traceContext,
      traceMetadata,
      maxValidateAttempts: 2,
    });

    const doc = buildDocument({
      parentId,
      title,
      content: graph.assembledDoc,
    });

    const saved = await saveAndIndex(userId, projectKey, doc);

    if (span) {
      traceManager.endSpan(span, {
        docId: saved.meta.id,
        mode: graph.mode,
        durationMs: Date.now() - startedAt,
      });
    }

    return { docId: saved.meta.id, title: saved.meta.title, mode: graph.mode };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (span) {
      traceManager.endSpan(
        span,
        {
          error: msg,
          durationMs: Date.now() - startedAt,
        },
        "ERROR",
      );
    }
    throw err;
  }
}

/**
 * Import an existing asset (by assetId) as a Zeus document using smart-import graph.
 * Used by Chat skill to convert uploaded attachments into documents without re-uploading.
 */
export async function importAssetAsDocument(
  userId: string,
  projectKey: string,
  input: ImportAssetInput,
): Promise<ImportFileResult> {
  const parentId = normalizeParentId(input.parentId);
  const safeTitle = (input.title ?? "").trim();
  const assetId = String(input.assetId ?? "").trim();
  if (!assetId) {
    throw new Error("assetId is required");
  }

  const loaded = await assetStore.getContent(userId, projectKey, assetId);
  if (!loaded) {
    throw new Error("Asset not found");
  }

  const filenameRaw = String(loaded.meta.filename ?? "").trim() || safeTitle || "Untitled";
  const title = safeTitle || stripExtension(filenameRaw) || "Untitled";
  const mime = guessMime(filenameRaw, loaded.meta.mime);
  const size = Number(loaded.meta.size ?? loaded.buffer.length ?? 0);
  const traceContext = input.traceContext;
  const traceMetadata = input.traceMetadata ?? {};

  const span = traceContext
    ? traceManager.startSpan(traceContext, "smart-import", {
        assetId,
        filename: filenameRaw,
        mime,
        size,
        parentId,
        smartImport: input.smartImport === true,
        smartType: smartTypeForFile(filenameRaw, mime),
        enableFormatOptimize: input.enableFormatOptimize === true,
        ...traceMetadata,
      })
    : null;
  const startedAt = Date.now();

  try {
    const types = normalizeTypes(input.smartImportTypes);
    const graph = await runSmartImportGraph({
      userId,
      projectKey,
      title,
      parentId,
      file: {
        buffer: loaded.buffer,
        originalname: filenameRaw,
        mimetype: mime,
        size,
      },
      assetMeta: {
        id: assetId,
        filename: loaded.meta.filename,
        mime: guessMime(loaded.meta.filename, loaded.meta.mime),
        size: loaded.meta.size,
      },
      smartImport: input.smartImport === true,
      smartImportTypes: Array.from(types),
      enableFormatOptimize: input.enableFormatOptimize === true,
      traceContext,
      traceMetadata,
      maxValidateAttempts: 2,
    });

    const doc = buildDocument({
      parentId,
      title,
      content: graph.assembledDoc,
    });

    const saved = await saveAndIndex(userId, projectKey, doc);

    if (span) {
      traceManager.endSpan(span, {
        docId: saved.meta.id,
        mode: graph.mode,
        durationMs: Date.now() - startedAt,
      });
    }

    return { docId: saved.meta.id, title: saved.meta.title, mode: graph.mode };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (span) {
      traceManager.endSpan(
        span,
        {
          error: msg,
          durationMs: Date.now() - startedAt,
        },
        "ERROR",
      );
    }
    throw err;
  }
}

