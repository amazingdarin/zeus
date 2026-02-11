import path from "node:path";

import type { JSONContent } from "@tiptap/core";

import { convertDocument } from "./convert.js";
import type { SmartImportType } from "./smart-import-types.js";
import { buildScopedProjectPath } from "../project-scope.js";

export function stripExtension(filename: string): string {
  const base = filename.trim();
  const idx = base.lastIndexOf(".");
  if (idx <= 0) return base;
  return base.slice(0, idx);
}

export function normalizeParentId(value: string): string {
  const trimmed = String(value ?? "").trim();
  return trimmed && trimmed !== "root" ? trimmed : "root";
}

export function normalizeTypes(types?: SmartImportType[]): Set<SmartImportType> {
  const out = new Set<SmartImportType>();
  for (const t of types ?? []) {
    if (t === "markdown" || t === "word" || t === "pdf" || t === "image") {
      out.add(t);
    }
  }
  return out;
}

export function extOf(filename: string): string {
  return path.extname(filename).replace(/^\./, "").toLowerCase();
}

export function isImageFile(filename: string, mime: string): boolean {
  const normalizedMime = mime.toLowerCase();
  if (normalizedMime.startsWith("image/")) return true;
  const ext = extOf(filename);
  return ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext);
}

export function guessMime(filename: string, provided?: string): string {
  const normalized = String(provided ?? "").trim();
  if (normalized) return normalized;

  const ext = extOf(filename);
  switch (ext) {
    case "pdf":
      return "application/pdf";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "md":
    case "markdown":
      return "text/markdown";
    case "txt":
      return "text/plain";
    case "json":
      return "application/json";
    case "yaml":
    case "yml":
      return "application/x-yaml";
    case "csv":
      return "text/csv";
    default:
      return "application/octet-stream";
  }
}

export function resolveFileKind(
  fileName: string,
  mime: string,
): { fileType: "office" | "text" | "unknown"; officeType?: string } {
  const OFFICE_MIME_MAP: Record<string, "pdf" | "docx" | "pptx" | "xlsx"> = {
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  };

  const OFFICE_EXT_MAP: Record<string, "pdf" | "docx" | "pptx" | "xlsx"> = {
    pdf: "pdf",
    docx: "docx",
    pptx: "pptx",
    xlsx: "xlsx",
  };

  const TEXT_EXTENSIONS = new Set(["txt", "md", "markdown", "csv", "json", "yaml", "yml", "log"]);

  const normalizedMime = mime.toLowerCase();
  if (normalizedMime in OFFICE_MIME_MAP) {
    return { fileType: "office", officeType: OFFICE_MIME_MAP[normalizedMime] };
  }
  if (normalizedMime.startsWith("text/")) {
    return { fileType: "text" };
  }

  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (ext in OFFICE_EXT_MAP) {
    return { fileType: "office", officeType: OFFICE_EXT_MAP[ext] };
  }
  if (TEXT_EXTENSIONS.has(ext)) {
    return { fileType: "text" };
  }

  return { fileType: "unknown" };
}

export function buildAssetContentUrl(projectKey: string, assetId: string): string {
  return `/api/projects/${buildScopedProjectPath(projectKey)}/assets/${encodeURIComponent(assetId)}/content`;
}

export function buildFileBlockNode(assetMeta: {
  id: string;
  filename: string;
  mime: string;
  size: number;
}): JSONContent {
  const { fileType, officeType } = resolveFileKind(assetMeta.filename, assetMeta.mime);
  return {
    type: "file_block",
    attrs: {
      asset_id: assetMeta.id,
      file_name: assetMeta.filename,
      mime: assetMeta.mime,
      size: assetMeta.size,
      file_type: fileType,
      office_type: officeType ?? "",
    },
  } as unknown as JSONContent;
}

export function buildImageNode(projectKey: string, assetId: string, title: string): JSONContent {
  return {
    type: "image",
    attrs: {
      src: buildAssetContentUrl(projectKey, assetId),
      alt: title,
      title,
    },
  } as unknown as JSONContent;
}

export function toMulterFile(
  buffer: Buffer,
  originalname: string,
  mimetype: string,
): Express.Multer.File {
  return {
    buffer,
    originalname,
    mimetype,
    fieldname: "file",
    size: buffer.length,
    destination: "",
    encoding: "",
    filename: "",
    path: "",
    stream: undefined,
  } as unknown as Express.Multer.File;
}

export async function convertBufferToMarkdown(
  userId: string,
  projectKey: string,
  buffer: Buffer,
  originalname: string,
  mimetype: string,
  from: string,
): Promise<string> {
  const file = toMulterFile(buffer, originalname, mimetype);
  const result = await convertDocument(userId, projectKey, file, from, "markdown");
  return String(result.content ?? "");
}

export function dataUrlFromBuffer(mime: string, buffer: Buffer): string {
  const base64 = buffer.toString("base64");
  return `data:${mime};base64,${base64}`;
}

export function smartTypeForFile(filename: string, mime: string): SmartImportType | null {
  if (isImageFile(filename, mime)) return "image";

  const ext = extOf(filename);
  if (["md", "markdown", "txt"].includes(ext)) return "markdown";
  if (ext === "docx") return "word";
  if (ext === "pdf") return "pdf";
  return null;
}

