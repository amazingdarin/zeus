import { Document, LevelFormat, Packer, Paragraph, type ILevelsOptions } from "docx";

import { documentStore } from "../storage/document-store.js";
import { assetStore } from "../storage/asset-store.js";
import { extractTiptapDoc } from "../utils/tiptap-content.js";
import {
  mapTiptapToDocxBlocks,
  ORDERED_LIST_REFERENCE,
  type ResolvedImage,
} from "./export-docx-mapper.js";

export const DOCX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export type ExportDocumentToDocxInput = {
  userId: string;
  projectKey: string;
  docId: string;
};

export type ExportDocumentToDocxResult = {
  buffer: Buffer;
  filename: string;
  asciiFilename: string;
  contentType: string;
  unsupportedNodeTypes: string[];
  imageEmbeddedCount: number;
  imageFallbackCount: number;
};

export class ExportDocxError extends Error {
  public readonly code: string;
  public readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ExportDocxError";
    this.code = code;
    this.status = status;
  }
}

const SUPPORTED_IMAGE_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/bmp",
]);

export async function exportDocumentToDocxBuffer(
  input: ExportDocumentToDocxInput,
): Promise<ExportDocumentToDocxResult> {
  const startedAt = Date.now();
  let imageEmbeddedCount = 0;
  let imageFallbackCount = 0;

  const doc = await documentStore.get(input.userId, input.projectKey, input.docId);
  const tiptapDoc = extractTiptapDoc(doc.body);
  const nodes = Array.isArray(tiptapDoc.content) ? tiptapDoc.content : [];
  if (nodes.length === 0) {
    throw new ExportDocxError("EMPTY_DOCUMENT", "Document has no exportable content", 422);
  }

  const mapped = await mapTiptapToDocxBlocks(tiptapDoc, {
    resolveImage: async ({ src, attrs }) => {
      return resolveImageForDocx({
        userId: input.userId,
        projectKey: input.projectKey,
        src,
        attrs,
      });
    },
    onImageEmbedded: () => {
      imageEmbeddedCount += 1;
    },
    onImageFallback: () => {
      imageFallbackCount += 1;
    },
  });

  const children = mapped.blocks.length > 0 ? mapped.blocks : [new Paragraph("")];
  const wordDocument = new Document({
    numbering: mapped.usesOrderedList
      ? {
          config: [{
            reference: ORDERED_LIST_REFERENCE,
            levels: buildOrderedListLevels(),
          }],
        }
      : undefined,
    sections: [{ children }],
  });

  const buffer = await Packer.toBuffer(wordDocument);
  const filenameBase = sanitizeFilenamePart(String(doc.meta?.title || "document"));
  const filename = `${filenameBase}.docx`;
  const durationMs = Date.now() - startedAt;

  console.info("[export-docx] done", {
    projectKey: input.projectKey,
    docId: input.docId,
    durationMs,
    unsupportedNodeTypes: mapped.unsupportedNodeTypes,
    imageEmbeddedCount,
    imageFallbackCount,
  });

  return {
    buffer,
    filename,
    asciiFilename: toAsciiFilename(filename),
    contentType: DOCX_CONTENT_TYPE,
    unsupportedNodeTypes: mapped.unsupportedNodeTypes,
    imageEmbeddedCount,
    imageFallbackCount,
  };
}

function buildOrderedListLevels(): ILevelsOptions[] {
  const levels: ILevelsOptions[] = [];
  for (let level = 0; level <= 8; level += 1) {
    levels.push({
      level,
      format: LevelFormat.DECIMAL,
      text: buildNumberingText(level),
      style: {
        paragraph: {
          indent: {
            left: 720 + level * 360,
            hanging: 240,
          },
        },
      },
    });
  }
  return levels;
}

function buildNumberingText(level: number): string {
  const parts: string[] = [];
  for (let i = 1; i <= level + 1; i += 1) {
    parts.push(`%${i}`);
  }
  return `${parts.join(".")}.`;
}

async function resolveImageForDocx(input: {
  userId: string;
  projectKey: string;
  src: string;
  attrs: Record<string, unknown>;
}): Promise<ResolvedImage | null> {
  const src = String(input.src || "").trim();
  if (!src) {
    return null;
  }

  const fromDataUrl = parseDataUrl(src);
  if (fromDataUrl) {
    const mime = fromDataUrl.mime.toLowerCase();
    if (!SUPPORTED_IMAGE_MIME.has(mime)) {
      return null;
    }
    return {
      data: fromDataUrl.buffer,
      type: imageTypeFromMime(mime),
      width: toPositiveInt(input.attrs.width),
      height: toPositiveInt(input.attrs.height),
    };
  }

  const assetId = extractAssetId(input.attrs, src);
  if (!assetId) {
    return null;
  }

  const asset = await assetStore.getContent(input.userId, input.projectKey, assetId);
  if (!asset) {
    return null;
  }

  const mime = String(asset.meta?.mime || "").trim().toLowerCase();
  if (!SUPPORTED_IMAGE_MIME.has(mime)) {
    return null;
  }

  return {
    data: asset.buffer,
    type: imageTypeFromMime(mime),
    width: toPositiveInt(input.attrs.width),
    height: toPositiveInt(input.attrs.height),
  };
}

function extractAssetId(attrs: Record<string, unknown>, src: string): string | null {
  const fromAttr = String(attrs.asset_id ?? attrs.assetId ?? "").trim();
  if (fromAttr) {
    return fromAttr;
  }

  try {
    const parsed = new URL(src, "http://localhost");
    const match = parsed.pathname.match(/\/assets\/([^/]+)\/content\/?$/i);
    if (match?.[1]) {
      return decodeURIComponent(match[1]);
    }
    const q = String(parsed.searchParams.get("asset_id") || parsed.searchParams.get("assetId") || "").trim();
    if (q) {
      return q;
    }
  } catch {
    // Ignore invalid URLs.
  }

  return null;
}

function sanitizeFilenamePart(value: string): string {
  const normalized = value.trim().replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "document";
  }
  return normalized.slice(0, 120);
}

function toAsciiFilename(value: string): string {
  const ascii = value.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "_").trim();
  return ascii || "document.docx";
}

function toPositiveInt(value: unknown): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return undefined;
  }
  return Math.floor(n);
}

function parseDataUrl(src: string): { mime: string; buffer: Buffer } | null {
  const match = /^data:([^;,]+)?(;base64)?,([\s\S]+)$/i.exec(src);
  if (!match) {
    return null;
  }

  const mime = String(match[1] || "application/octet-stream").trim().toLowerCase();
  const isBase64 = Boolean(match[2]);
  const payload = match[3] || "";

  try {
    const buffer = isBase64
      ? Buffer.from(payload, "base64")
      : Buffer.from(decodeURIComponent(payload), "utf-8");
    return { mime, buffer };
  } catch {
    return null;
  }
}

function imageTypeFromMime(mime: string): "jpg" | "png" | "gif" | "bmp" {
  if (mime === "image/jpeg" || mime === "image/jpg") {
    return "jpg";
  }
  if (mime === "image/gif") {
    return "gif";
  }
  if (mime === "image/bmp") {
    return "bmp";
  }
  return "png";
}
