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
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

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

export type ParseMediaTranscriptionOptions = {
  language?: string;
  prompt?: string;
  model?: string;
  traceContext?: TraceContext;
};

export type TranscriptionConfigType = "transcription" | "llm" | "vision";

type TranscriptionRuntimeConfig = {
  enabled: boolean;
  providerId: string;
  baseUrl?: string;
  defaultModel?: string;
  apiKey?: string;
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

const AUDIO_EXTENSIONS = new Set([
  "mp3",
  "wav",
  "ogg",
  "m4a",
  "aac",
  "flac",
  "webm",
  "mpga",
  "mpeg",
]);

const VIDEO_EXTENSIONS = new Set([
  "mp4",
  "mov",
  "mkv",
  "avi",
  "webm",
  "m4v",
  "ogv",
]);

const TRANSCRIPTION_PROVIDER_IDS = new Set(["openai", "openai-compatible"]);
const DEFAULT_TRANSCRIPTION_MODEL =
  String(process.env.TRANSCRIPTION_MODEL || "").trim() || "whisper-1";
const DEFAULT_TRANSCRIPTION_MAX_BYTES = Number(
  process.env.TRANSCRIPTION_MAX_BYTES || 25 * 1024 * 1024,
);

export async function resolveTranscriptionRuntimeConfig(
  getConfigByType: (
    configType: TranscriptionConfigType,
  ) => Promise<TranscriptionRuntimeConfig | null>,
): Promise<{ configType: TranscriptionConfigType; config: TranscriptionRuntimeConfig } | null> {
  const transcriptionConfig = await getConfigByType("transcription");
  if (transcriptionConfig) {
    if (!transcriptionConfig.enabled) {
      throw new Error("音视频转写配置已禁用，请在设置中启用。");
    }
    return {
      configType: "transcription",
      config: transcriptionConfig,
    };
  }

  const llmConfig = await getConfigByType("llm");
  if (llmConfig?.enabled) {
    return {
      configType: "llm",
      config: llmConfig,
    };
  }

  const visionConfig = await getConfigByType("vision");
  if (visionConfig?.enabled) {
    return {
      configType: "vision",
      config: visionConfig,
    };
  }

  return null;
}

function isAudioMedia(filename: string, mime: string): boolean {
  const normalizedMime = String(mime || "").toLowerCase();
  if (normalizedMime.startsWith("audio/")) {
    return true;
  }
  return AUDIO_EXTENSIONS.has(extOf(filename));
}

function isVideoMedia(filename: string, mime: string): boolean {
  const normalizedMime = String(mime || "").toLowerCase();
  if (normalizedMime.startsWith("video/")) {
    return true;
  }
  return VIDEO_EXTENSIONS.has(extOf(filename));
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function stripKnownModelApiSuffix(value: string): string {
  return value.replace(
    /\/(?:chat\/completions|completions|responses)$/i,
    "",
  );
}

export function buildTranscriptionEndpoints(providerId: string, baseUrl?: string): string[] {
  const providedBase = String(baseUrl || "").trim();
  const rawBase =
    stripTrailingSlash(providedBase) ||
    (providerId === "openai" ? "https://api.openai.com/v1" : "");
  if (!rawBase) {
    throw new Error("转写模型未配置 baseUrl，请在设置中配置 OpenAI 兼容地址。");
  }

  // If callers configured the full transcription endpoint, use it directly.
  if (/\/audio\/transcriptions$/i.test(rawBase)) {
    return [rawBase];
  }

  const normalizedBase = stripTrailingSlash(stripKnownModelApiSuffix(rawBase));
  const endpoints: string[] = [];
  const push = (endpoint: string) => {
    const trimmed = stripTrailingSlash(endpoint);
    if (!trimmed) return;
    if (endpoints.includes(trimmed)) return;
    endpoints.push(trimmed);
  };

  if (normalizedBase.endsWith("/v1")) {
    push(`${normalizedBase}/audio/transcriptions`);
    if (providedBase) {
      const baseWithoutV1 = stripTrailingSlash(normalizedBase.slice(0, -3));
      if (baseWithoutV1) {
        push(`${baseWithoutV1}/audio/transcriptions`);
      }
    }
  } else {
    push(`${normalizedBase}/v1/audio/transcriptions`);
    if (providedBase) {
      push(`${normalizedBase}/audio/transcriptions`);
    }
  }

  return endpoints;
}

function buildTranscriptionForm(
  prepared: { buffer: Buffer; filename: string; mime: string },
  model: string,
  options: ParseMediaTranscriptionOptions,
): FormData {
  const form = new FormData();
  form.append(
    "file",
    new Blob([prepared.buffer], { type: prepared.mime || "audio/mpeg" }),
    prepared.filename,
  );
  form.append("model", model);
  if (options.language && options.language.trim()) {
    form.append("language", options.language.trim());
  }
  if (options.prompt && options.prompt.trim()) {
    form.append("prompt", options.prompt.trim());
  }
  return form;
}

function runCommand(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk ?? "");
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `${cmd} exited with code ${code}`));
    });
  });
}

async function prepareMediaForTranscription(input: {
  buffer: Buffer;
  filename: string;
  mime: string;
}): Promise<{
  buffer: Buffer;
  filename: string;
  mime: string;
  sourceType: "audio" | "video";
  extractedFromVideo: boolean;
}> {
  const { buffer, filename, mime } = input;
  if (isAudioMedia(filename, mime)) {
    return {
      buffer,
      filename,
      mime: mime || "audio/mpeg",
      sourceType: "audio",
      extractedFromVideo: false,
    };
  }

  if (!isVideoMedia(filename, mime)) {
    throw new Error("仅支持音频或视频文件转写。");
  }

  const tempDir = await fs.mkdtemp(path.join(tmpdir(), "zeus-transcribe-"));
  const inputExt = extOf(filename);
  const inputName = inputExt ? `source.${inputExt}` : "source.bin";
  const inputPath = path.join(tempDir, inputName);
  const outputPath = path.join(tempDir, "audio.m4a");
  try {
    await fs.writeFile(inputPath, buffer);
    await runCommand("ffmpeg", [
      "-y",
      "-i",
      inputPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "aac",
      "-b:a",
      "64k",
      outputPath,
    ]);
    const audioBuffer = await fs.readFile(outputPath);
    const stem = filename.replace(/\.[^.]+$/, "") || "audio";
    return {
      buffer: audioBuffer,
      filename: `${stem}.m4a`,
      mime: "audio/mp4",
      sourceType: "video",
      extractedFromVideo: true,
    };
  } catch (err) {
    throw new Error(
      `视频转写前提取音轨失败: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

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
// Audio/Video Transcription
// ============================================================================

/**
 * Parse speech text from audio/video.
 *
 * Uses OpenAI-compatible `/audio/transcriptions` API.
 */
export async function parseMediaTranscription(
  buffer: Buffer,
  filename: string,
  mime?: string,
  options: ParseMediaTranscriptionOptions = {},
): Promise<ParseResult> {
  const resolvedMime = guessMime(filename, mime);
  const prepared = await prepareMediaForTranscription({
    buffer,
    filename,
    mime: resolvedMime,
  });

  if (!Number.isFinite(DEFAULT_TRANSCRIPTION_MAX_BYTES) || DEFAULT_TRANSCRIPTION_MAX_BYTES <= 0) {
    throw new Error("TRANSCRIPTION_MAX_BYTES 配置无效");
  }
  if (prepared.buffer.length > DEFAULT_TRANSCRIPTION_MAX_BYTES) {
    throw new Error(
      `媒体文件过大（${prepared.buffer.length} bytes），请控制在 ${DEFAULT_TRANSCRIPTION_MAX_BYTES} bytes 内。`,
    );
  }

  const { configStore } = await import("../llm/index.js");
  const resolvedConfig = await resolveTranscriptionRuntimeConfig((configType) =>
    configStore.getInternalByType(configType),
  );
  if (!resolvedConfig) {
    throw new Error("未配置可用模型，无法进行音视频转写。请优先配置“音视频转写”模型。");
  }
  const { config, configType } = resolvedConfig;

  const providerId = String(config.providerId || "").trim().toLowerCase();
  if (!TRANSCRIPTION_PROVIDER_IDS.has(providerId)) {
    throw new Error(
      `当前 provider ${config.providerId} 暂不支持转写，请使用 OpenAI 或 OpenAI-Compatible。`,
    );
  }
  if (providerId === "openai" && !config.apiKey) {
    throw new Error("OpenAI 转写必须配置 API Key。");
  }

  const endpoints = buildTranscriptionEndpoints(providerId, config.baseUrl);
  const model = String(options.model || "").trim() || DEFAULT_TRANSCRIPTION_MODEL;
  const endpointErrors: Array<{
    endpoint: string;
    status?: number;
    message: string;
  }> = [];
  let rawText = "";

  for (const endpoint of endpoints) {
    try {
      const headers: Record<string, string> = {};
      if (config.apiKey) {
        headers.Authorization = `Bearer ${config.apiKey}`;
      }
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: buildTranscriptionForm(prepared, model, options),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        endpointErrors.push({
          endpoint,
          status: response.status,
          message: errorText.slice(0, 400) || "unknown error",
        });

        // Try fallback endpoints for common compatibility misses.
        if ((response.status === 404 || response.status === 405 || response.status === 501)
          && endpoint !== endpoints[endpoints.length - 1]) {
          continue;
        }
        break;
      }

      rawText = await response.text();
      if (!rawText.trim()) {
        endpointErrors.push({
          endpoint,
          status: response.status,
          message: "empty response body",
        });
        if (endpoint !== endpoints[endpoints.length - 1]) {
          continue;
        }
      } else {
        break;
      }
    } catch (err) {
      endpointErrors.push({
        endpoint,
        message: err instanceof Error ? err.message : String(err),
      });
      if (endpoint !== endpoints[endpoints.length - 1]) {
        continue;
      }
    }
  }

  if (!rawText.trim()) {
    const detail = endpointErrors
      .map((item) => {
        const statusPart = typeof item.status === "number" ? ` (${item.status})` : "";
        return `${item.endpoint}${statusPart}: ${item.message}`;
      })
      .join(" | ");
    throw new Error(`转写请求失败: ${detail || "unknown error"}`);
  }

  let text = "";
  let detectedLanguage = "";
  let durationSec: number | undefined;
  try {
    const payload = JSON.parse(rawText) as {
      text?: unknown;
      language?: unknown;
      duration?: unknown;
    };
    text = typeof payload.text === "string" ? payload.text.trim() : "";
    detectedLanguage =
      typeof payload.language === "string" ? payload.language.trim() : "";
    durationSec =
      typeof payload.duration === "number" && Number.isFinite(payload.duration)
        ? payload.duration
        : undefined;
  } catch {
    text = rawText.trim();
  }

  if (!text) {
    throw new Error("转写完成，但未返回有效文本。");
  }

  return {
    content: text,
    format: "text",
    sourceType: prepared.sourceType,
    metadata: {
      filename,
      mime: resolvedMime,
      provider: config.providerId,
      configType,
      model,
      language: detectedLanguage || options.language,
      durationSec,
      extractedFromVideo: prepared.extractedFromVideo,
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
