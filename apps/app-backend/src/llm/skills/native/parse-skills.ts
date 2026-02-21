import type { SkillIntent, SkillStreamChunk } from "../types.js";
import type { TraceContext } from "../../../observability/index.js";
import { assetStore } from "../../../storage/asset-store.js";
import {
  parseFile,
  parseImage,
  parseMediaTranscription,
  parseUrl,
} from "../../../services/parse-service.js";
import {
  buildMediaCandidateDescription,
  normalizeMediaScope,
  normalizeAssetIdList,
  resolveCandidateKey,
  resolveCandidateKeys,
  resolveMediaTranscribeCandidates,
} from "../../../services/media-transcribe-context.js";

/**
 * Parse Skills (file-parse, image-analyze, media-transcribe, url-extract)
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

/**
 * Execute media-transcribe skill
 *
 * Loads audio/video asset from store and transcribes speech to text.
 * Does NOT create a document.
 */
export async function* executeMediaTranscribe(
  userId: string,
  projectKey: string,
  intent: SkillIntent,
  traceContext?: TraceContext,
): AsyncGenerator<SkillStreamChunk> {
  const rawAssetId = String(intent.args.asset_id || "").trim();
  const requestedAssetIds = normalizeAssetIdList(intent.args.asset_ids);
  const candidateAssetId = resolveCandidateKey(intent.args, intent.args.candidate_key);
  const candidateAssetIds = resolveCandidateKeys(intent.args, intent.args.candidate_keys);
  const targetMode = typeof intent.args.target_mode === "string" ? intent.args.target_mode.trim() : "";
  const mediaScope = normalizeMediaScope(intent.args.media_scope);

  if (rawAssetId && rawAssetId !== "__ALL__") {
    requestedAssetIds.unshift(rawAssetId);
  }
  if (candidateAssetId) {
    requestedAssetIds.unshift(candidateAssetId);
  }
  if (candidateAssetIds.length > 0) {
    requestedAssetIds.push(...candidateAssetIds);
  }

  const docIdArg = typeof intent.args.doc_id === "string"
    ? intent.args.doc_id.trim()
    : "";
  const blockIdArg = typeof intent.args.block_id === "string"
    ? intent.args.block_id.trim()
    : "";

  const seen = new Set<string>();
  const dedupedRequestedAssetIds: string[] = [];
  for (const assetId of requestedAssetIds) {
    if (!assetId || seen.has(assetId)) continue;
    seen.add(assetId);
    dedupedRequestedAssetIds.push(assetId);
  }

  if (dedupedRequestedAssetIds.length === 0 || rawAssetId === "__ALL__" || targetMode === "all") {
    const candidates = await resolveMediaTranscribeCandidates({
      userId,
      projectKey,
      docIds: docIdArg ? [docIdArg] : intent.docIds,
      explicitDocId: docIdArg || undefined,
      explicitBlockId: blockIdArg || undefined,
      mediaScope,
      maxCandidates: 30,
    });

    if (rawAssetId === "__ALL__" || targetMode === "all") {
      for (const candidate of candidates) {
        if (seen.has(candidate.assetId)) continue;
        seen.add(candidate.assetId);
        dedupedRequestedAssetIds.push(candidate.assetId);
      }
    } else if (dedupedRequestedAssetIds.length === 0) {
      if (candidates.length === 1) {
        dedupedRequestedAssetIds.push(candidates[0].assetId);
      } else if (candidates.length > 1) {
        yield {
          type: "error",
          error: `命中多个媒体候选，请指定 candidate_key 或设置 target_mode=all。\n${buildMediaCandidateDescription(candidates, 10)}`,
        };
        return;
      }
    }
  }

  if (dedupedRequestedAssetIds.length === 0) {
    yield {
      type: "error",
      error: "未找到可转写的媒体。请上传音视频附件，或提供 candidate_key / doc_id + block_id。",
    };
    return;
  }

  const language =
    typeof intent.args.language === "string" ? intent.args.language.trim() : undefined;
  const prompt =
    typeof intent.args.prompt === "string" ? intent.args.prompt.trim() : undefined;
  const model =
    typeof intent.args.model === "string" ? intent.args.model.trim() : undefined;

  yield {
    type: "thinking",
    content: dedupedRequestedAssetIds.length > 1
      ? `正在批量转写 ${dedupedRequestedAssetIds.length} 个媒体文件...`
      : "正在加载媒体文件...",
  };

  const failures: string[] = [];
  let successCount = 0;

  for (let index = 0; index < dedupedRequestedAssetIds.length; index += 1) {
    const assetId = dedupedRequestedAssetIds[index];
    try {
      const asset = await assetStore.getContent(userId, projectKey, assetId);
      if (!asset) {
        failures.push(`asset_id=${assetId}: 附件不存在或已过期`);
        continue;
      }

      yield {
        type: "thinking",
        content: `正在转写 (${index + 1}/${dedupedRequestedAssetIds.length}) ${asset.meta.filename}...`,
      };

      const result = await parseMediaTranscription(
        asset.buffer,
        asset.meta.filename,
        asset.meta.mime,
        {
          language,
          prompt,
          model,
          traceContext,
        },
      );

      const text = result.content.trim();
      if (!text) {
        failures.push(`${asset.meta.filename}: 未提取到有效文本`);
        continue;
      }

      const maybeLanguage =
        typeof result.metadata?.language === "string" ? result.metadata.language.trim() : "";
      const languageLine = maybeLanguage ? `\n\n> 识别语言: ${maybeLanguage}` : "";

      if (dedupedRequestedAssetIds.length === 1) {
        yield {
          type: "delta",
          content: `**🎙️ ${asset.meta.filename} 转写结果**\n\n${text}${languageLine}`,
        };
      } else {
        const header = `## ${index + 1}. ${asset.meta.filename}\n\n`;
        yield {
          type: "delta",
          content: `${header}${text}${languageLine}\n`,
        };
      }

      successCount += 1;
    } catch (err) {
      failures.push(
        `asset_id=${assetId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (successCount === 0) {
    yield {
      type: "error",
      error: `音视频转写失败：${failures.join("；") || "未知错误"}`,
    };
    return;
  }

  const suffix = failures.length > 0
    ? `，失败 ${failures.length} 个（${failures.slice(0, 3).join("；")}）`
    : "";
  yield {
    type: "done",
    message: dedupedRequestedAssetIds.length > 1
      ? `音视频批量转写完成：成功 ${successCount} 个${suffix}`
      : `音视频转写完成${suffix}`,
  };
}
