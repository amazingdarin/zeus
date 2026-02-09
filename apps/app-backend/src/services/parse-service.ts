/**
 * Parse Service
 *
 * Provides pure parsing functions for extracting content from files, images,
 * and URLs. These functions do NOT create documents — they return parsed text
 * suitable for display in chat or injection as conversation context.
 *
 * Reuses existing infrastructure:
 * - convert.ts for PDF/Word/HTML conversion
 * - ocr.ts for image OCR
 * - fetch-url.ts + Readability for URL content extraction
 */

import TurndownService from "turndown";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

import { convertDocument } from "./convert.js";
import { fetchUrl } from "./fetch-url.js";
import { ocrService } from "./ocr.js";
import {
  guessMime,
  extOf,
  isImageFile,
  toMulterFile,
  dataUrlFromBuffer,
} from "./smart-import-shared.js";
import type { TraceContext } from "../observability/index.js";

// ============================================================================
// Types
// ============================================================================

export type ParseResult = {
  /** Parsed content (typically markdown) */
  content: string;
  /** Output format */
  format: "markdown" | "text";
  /** Detected source type (pdf, docx, image, html, etc.) */
  sourceType: string;
  /** Optional metadata about the parse operation */
  metadata?: Record<string, unknown>;
};

// ============================================================================
// File Parsing
// ============================================================================

/** File extensions handled by the convert pipeline */
const CONVERTIBLE_EXTENSIONS = new Set([
  "pdf", "docx", "html", "htm",
  "md", "markdown", "txt",
  "json", "yaml", "yml", "xml", "csv",
  "js", "ts", "jsx", "tsx", "py", "go", "rs", "java",
  "c", "cpp", "h", "hpp", "css", "scss", "less", "sql",
  "sh", "bash", "zsh", "vue", "svelte",
]);

/**
 * Detect the "from" format for the convert pipeline based on filename / mime.
 */
function detectFromFormat(filename: string, mime: string): string | null {
  const ext = extOf(filename);
  if (ext && CONVERTIBLE_EXTENSIONS.has(ext)) {
    // Map htm → html for the converter
    return ext === "htm" ? "html" : ext;
  }

  // Fallback: use MIME type
  const lower = mime.toLowerCase();
  if (lower === "application/pdf") return "pdf";
  if (lower.includes("wordprocessingml")) return "docx";
  if (lower === "text/html") return "html";
  if (lower === "text/plain") return "txt";
  if (lower === "text/markdown") return "md";
  if (lower === "application/json") return "json";
  if (lower.includes("yaml")) return "yaml";

  return null;
}

/**
 * Parse any supported file buffer into markdown text.
 *
 * Supports: PDF, Word (docx), HTML, Markdown, plain text, JSON, YAML, XML,
 * CSV, and common code file formats.
 */
export async function parseFile(
  buffer: Buffer,
  filename: string,
  mime?: string,
): Promise<ParseResult> {
  const resolvedMime = guessMime(filename, mime);

  // Reject images — callers should use parseImage instead
  if (isImageFile(filename, resolvedMime)) {
    throw new Error(
      "Image files should be parsed with parseImage(). Use image-analyze skill instead.",
    );
  }

  const from = detectFromFormat(filename, resolvedMime);
  if (!from) {
    throw new Error(`Unsupported file type: ${filename} (${resolvedMime})`);
  }

  const multerFile = toMulterFile(buffer, filename, resolvedMime);
  const result = await convertDocument("_parse", "_parse", multerFile, from, "markdown");

  return {
    content: result.content,
    format: "markdown",
    sourceType: from,
    metadata: {
      filename,
      mime: resolvedMime,
      size: buffer.length,
    },
  };
}

// ============================================================================
// Image Parsing
// ============================================================================

/**
 * Parse an image using OCR or LLM vision.
 *
 * When `question` is provided, uses LLM vision to answer the question about
 * the image rather than performing plain OCR.
 */
export async function parseImage(
  buffer: Buffer,
  mime: string,
  question?: string,
  traceContext?: TraceContext,
): Promise<ParseResult> {
  const resolvedMime = mime || "image/png";
  const dataUrl = dataUrlFromBuffer(resolvedMime, buffer);

  if (question) {
    // Use LLM vision to answer a question about the image
    const { generateText } = await import("ai");
    const { configStore } = await import("../llm/index.js");
    const { providerRegistry } = await import("../llm/providers.js");

    const config = await configStore.getInternalByType("vision")
      ?? await configStore.getInternalByType("llm");

    if (!config?.enabled || !config.defaultModel) {
      throw new Error("未配置视觉模型，无法分析图片。请在设置中配置视觉模型或 LLM。");
    }

    const model = providerRegistry.getLanguageModel(config.providerId, config.defaultModel, {
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
    });

    const result = await generateText({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: question },
            { type: "image", image: dataUrl },
          ],
        },
      ],
      temperature: 0.3,
      maxOutputTokens: 4096,
    });

    return {
      content: result.text,
      format: "text",
      sourceType: "image",
      metadata: {
        mime: resolvedMime,
        size: buffer.length,
        mode: "vision-qa",
        question,
      },
    };
  }

  // Default: OCR to extract text
  const ocrResult = await ocrService.parseImage(
    { image: dataUrl, outputFormat: "markdown" },
    {
      traceContext,
      metadata: { operation: "parse-skill" },
    },
  );

  const content = ocrResult.markdown || ocrResult.rawResponse || "";

  return {
    content,
    format: "markdown",
    sourceType: "image",
    metadata: {
      mime: resolvedMime,
      size: buffer.length,
      mode: "ocr",
      provider: ocrResult.provider,
    },
  };
}

// ============================================================================
// URL Parsing
// ============================================================================

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

/**
 * Fetch a URL and extract the main article content as clean Markdown.
 *
 * Uses Mozilla Readability for article extraction, then Turndown for HTML→MD
 * conversion. Falls back to raw text extraction if Readability fails.
 */
export async function parseUrl(url: string): Promise<ParseResult> {
  const result = await fetchUrl("_parse", "_parse", url);
  const html = result.html;

  // Try Readability extraction first
  const dom = new JSDOM(html, { url: result.url });
  const article = new Readability(dom.window.document).parse();

  let markdown: string;
  let title: string | undefined;

  if (article && article.content) {
    markdown = turndown.turndown(article.content);
    title = article.title || undefined;
  } else {
    // Fallback: convert full HTML
    markdown = turndown.turndown(html);
  }

  return {
    content: markdown,
    format: "markdown",
    sourceType: "url",
    metadata: {
      url: result.url,
      title,
      fetchedAt: result.fetched_at,
      contentLength: html.length,
    },
  };
}
