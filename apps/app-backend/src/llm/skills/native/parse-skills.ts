import type { SkillIntent, SkillStreamChunk } from "../types.js";
import type { TraceContext } from "../../../observability/index.js";
import { assetStore } from "../../../storage/asset-store.js";
import {
  parseFile,
  parseImage,
  parseUrl,
} from "../../../services/parse-service.js";

/**
 * Parse Skills (file-parse, image-analyze, url-extract)
 *
 * Read-only helpers:
 * - return extracted content into the conversation
 * - do not create or modify documents
 */

/**
 * Execute file-parse skill
 *
 * Loads asset buffer from store, detects file type, and extracts content as
 * markdown text. Does NOT create a document — content is returned directly
 * in the conversation.
 */
export async function* executeFileParse(
  userId: string,
  projectKey: string,
  intent: SkillIntent,
  traceContext?: TraceContext,
): AsyncGenerator<SkillStreamChunk> {
  const assetId = String(intent.args.asset_id || "").trim();
  if (!assetId) {
    yield { type: "error", error: "asset_id 参数不能为空，请先上传文件附件" };
    return;
  }

  yield { type: "thinking", content: "正在加载文件..." };

  try {
    const asset = await assetStore.getContent(userId, projectKey, assetId);
    if (!asset) {
      yield { type: "error", error: `未找到附件 ${assetId}，可能已过期或不存在` };
      return;
    }

    yield { type: "thinking", content: `正在解析 ${asset.meta.filename}...` };

    const result = await parseFile(asset.buffer, asset.meta.filename, asset.meta.mime);

    if (!result.content.trim()) {
      yield { type: "done", message: "文件解析完成，但未提取到有效内容" };
      return;
    }

    // Stream the parsed content
    yield {
      type: "delta",
      content: `**📄 ${asset.meta.filename}** (${result.sourceType})\n\n${result.content}`,
    };
    yield { type: "done", message: `文件解析完成 (${result.sourceType})` };
  } catch (err) {
    yield {
      type: "error",
      error: `文件解析失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Execute image-analyze skill
 *
 * Loads image asset from store and performs OCR or LLM vision Q&A.
 * Does NOT create a document.
 */
export async function* executeImageAnalyze(
  userId: string,
  projectKey: string,
  intent: SkillIntent,
  traceContext?: TraceContext,
): AsyncGenerator<SkillStreamChunk> {
  const assetId = String(intent.args.asset_id || "").trim();
  if (!assetId) {
    yield { type: "error", error: "asset_id 参数不能为空，请先上传图片附件" };
    return;
  }

  const question =
    typeof intent.args.question === "string" ? intent.args.question.trim() : undefined;

  yield { type: "thinking", content: question ? "正在分析图片..." : "正在识别图片文字..." };

  try {
    const asset = await assetStore.getContent(userId, projectKey, assetId);
    if (!asset) {
      yield { type: "error", error: `未找到附件 ${assetId}，可能已过期或不存在` };
      return;
    }

    const result = await parseImage(asset.buffer, asset.meta.mime, question, traceContext);

    if (!result.content.trim()) {
      yield { type: "done", message: "图片分析完成，但未提取到有效内容" };
      return;
    }

    const header = question
      ? `**🖼️ ${asset.meta.filename}** — ${question}`
      : `**🖼️ ${asset.meta.filename}** OCR 识别结果`;

    yield {
      type: "delta",
      content: `${header}\n\n${result.content}`,
    };
    yield {
      type: "done",
      message: question ? "图片分析完成" : "图片文字识别完成",
    };
  } catch (err) {
    yield {
      type: "error",
      error: `图片分析失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Execute url-extract skill
 *
 * Fetches URL and extracts clean article content as Markdown.
 * Does NOT create a document.
 */
export async function* executeUrlExtract(
  _userId: string,
  _projectKey: string,
  intent: SkillIntent,
): AsyncGenerator<SkillStreamChunk> {
  const targetUrl = String(intent.args.url || "").trim();
  if (!targetUrl) {
    yield { type: "error", error: "url 参数不能为空" };
    return;
  }

  yield { type: "thinking", content: `正在抓取 ${targetUrl}...` };

  try {
    const result = await parseUrl(targetUrl);

    if (!result.content.trim()) {
      yield { type: "done", message: "页面抓取完成，但未提取到有效内容" };
      return;
    }

    const title = (result.metadata?.title as string) || targetUrl;
    yield {
      type: "delta",
      content: `**🔗 ${title}**\n\n${result.content}`,
    };
    yield { type: "done", message: "URL 内容提取完成" };
  } catch (err) {
    yield {
      type: "error",
      error: `URL 提取失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

