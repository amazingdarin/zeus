/**
 * Skill Executor
 *
 * Executes document skills with LLM integration.
 */

import type { JSONContent } from "@tiptap/core";
import { v4 as uuidv4 } from "uuid";

import { llmGateway } from "../gateway.js";
import { configStore } from "../config-store.js";
import { documentStore } from "../../storage/document-store.js";
import { assetStore } from "../../storage/asset-store.js";
import { draftService } from "../../services/draft.js";
import {
  buildCreateDocumentPrompt,
  buildEditDocumentPrompt,
  buildPptOptimizeDocumentPrompt,
  buildPptOutlineDocumentPrompt,
  buildPptHtmlModelPrompt,
} from "./spec-loader.js";
import type {
  SkillIntent,
  SkillStreamChunk,
  DocumentDraft,
} from "./types.js";
import { validateTiptapContent, fixCommonIssues } from "./validator.js";
import { tiptapJsonToMarkdown, markdownToTiptapJson } from "../../utils/markdown.js";
import { skillConfigStore } from "./skill-config-store.js";
import { ensureBlockIds } from "../../utils/block-id.js";
import { extractTiptapDoc } from "../../utils/tiptap-content.js";
import { traceManager, type TraceContext } from "../../observability/index.js";
import {
  getOptimizeCapability,
  runDocOptimize,
  type OptimizeCapabilityId,
} from "../agent/optimize/index.js";
import {
  executeDocRead,
  executeDocGet,
  executeDocMove,
  executeDocDelete,
} from "./native/doc-basic-skills.js";
import {
  executeFileParse,
  executeImageAnalyze,
  executeMediaTranscribe,
  executeUrlExtract,
} from "./native/parse-skills.js";
import {
  executeDocOrganize,
  executeKbSearch,
  executeWebSearch,
  executeDocFetchUrl,
  executeDocImportGit,
  executeDocSmartImport,
  executeDocConvert,
} from "./native/integration-skills.js";
import { pptService } from "../../services/ppt/index.js";
import { querySuggestsBatchTranscription } from "../../services/media-transcribe-context.js";
import {
  normalizePptHtmlModel,
  renderPptHtmlFromModel,
  sanitizePptHtml,
  type PptHtmlModel,
} from "../../services/ppt/html-render.js";
import { buildFileBlockNode } from "../../services/smart-import-shared.js";

// Maximum retries for LLM content generation
const MAX_RETRIES = 2;

function parseMediaTranscribeCommandArgs(
  rawText: string,
): Record<string, unknown> {
  const text = String(rawText || "").trim();
  if (!text) return {};

  const assetMatch = text.match(/(?:^|\s)asset[_-]?id\s*[:=]\s*([a-zA-Z0-9_-]+)/i);
  const docMatch = text.match(/(?:^|\s)doc[_-]?id\s*[:=]\s*([a-zA-Z0-9_-]+)/i);
  const blockMatch = text.match(/(?:^|\s)block[_-]?id\s*[:=]\s*([a-zA-Z0-9_-]+)/i);
  const args: Record<string, unknown> = {};
  if (assetMatch?.[1]) args.asset_id = assetMatch[1].trim();
  if (docMatch?.[1]) args.doc_id = docMatch[1].trim();
  if (blockMatch?.[1]) args.block_id = blockMatch[1].trim();
  if (Object.keys(args).length > 0) {
    return args;
  }

  if (querySuggestsBatchTranscription(text)) {
    return { asset_id: "__ALL__" };
  }

  // Fallback only for token-like values to avoid treating natural language as asset_id.
  if (/^[a-zA-Z0-9_-]+$/.test(text)) {
    return { asset_id: text };
  }

  return {};
}

function parseDocGetCommandArgs(
  rawText: string,
): Record<string, unknown> {
  const text = String(rawText || "").trim();
  if (!text) return {};

  const tokens = text.split(/\s+/).filter(Boolean);
  const args: Record<string, unknown> = {};
  let inferredDocId = "";

  for (const token of tokens) {
    const normalized = token.trim();
    if (!normalized) continue;

    if (normalized === "--content" || normalized === "content" || normalized === "include_content=true") {
      args.include_content = true;
      continue;
    }
    if (normalized === "--no-block-attrs" || normalized === "include_block_attrs=false") {
      args.include_block_attrs = false;
      continue;
    }
    if (normalized.startsWith("doc_id=")) {
      const value = normalized.slice("doc_id=".length).trim();
      if (value) args.doc_id = value;
      continue;
    }
    if (normalized.startsWith("block_types=") || normalized.startsWith("--block-types=")) {
      const raw = normalized.split("=", 2)[1] || "";
      const values = raw
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      if (values.length > 0) {
        args.block_types = values;
      }
      continue;
    }

    if (!inferredDocId && /^[a-zA-Z0-9_-]+$/.test(normalized)) {
      inferredDocId = normalized;
    }
  }

  if (!args.doc_id && inferredDocId) {
    args.doc_id = inferredDocId;
  }

  return args;
}

/**
 * Detect skill intent from user message (sync version - only checks explicit commands)
 *
 * @deprecated Use `analyzeTrigger` from trigger.ts for natural language support.
 * This function only detects explicit slash commands for backward compatibility.
 */
export function detectSkillIntent(
  message: string,
  docIds?: string[],
): SkillIntent | null {
  const trimmed = message.trim();

  // Check for explicit slash commands only
  // Natural language patterns are now handled by analyzeTrigger + LLM tool selection

  if (trimmed.startsWith("/doc-create")) {
    const rest = trimmed.slice("/doc-create".length).trim();
    const parentId = docIds && docIds.length > 0 ? docIds[0] : undefined;
    return {
      skill: "doc-create",
      command: "/doc-create",
      args: { title: rest || "新文档", description: rest, parent_id: parentId },
      rawMessage: message,
      docIds,
    };
  }

  if (trimmed.startsWith("/doc-edit")) {
    const rest = trimmed.slice("/doc-edit".length).trim();
    return {
      skill: "doc-edit",
      command: "/doc-edit",
      args: { instructions: rest },
      rawMessage: message,
      docIds,
    };
  }

  if (trimmed.startsWith("/doc-read")) {
    return {
      skill: "doc-read",
      command: "/doc-read",
      args: {},
      rawMessage: message,
      docIds,
    };
  }

  if (trimmed.startsWith("/doc-get")) {
    const rest = trimmed.slice("/doc-get".length).trim();
    return {
      skill: "doc-get",
      command: "/doc-get",
      args: parseDocGetCommandArgs(rest),
      rawMessage: message,
      docIds,
    };
  }

  if (trimmed.startsWith("/doc-optimize-format")) {
    const rest = trimmed.slice("/doc-optimize-format".length).trim();
    return {
      skill: "doc-optimize-format",
      command: "/doc-optimize-format",
      args: rest ? { instructions: rest } : {},
      rawMessage: message,
      docIds,
    };
  }

  if (trimmed.startsWith("/doc-optimize-content")) {
    const rest = trimmed.slice("/doc-optimize-content".length).trim();
    return {
      skill: "doc-optimize-content",
      command: "/doc-optimize-content",
      args: rest ? { instructions: rest } : {},
      rawMessage: message,
      docIds,
    };
  }

  if (trimmed.startsWith("/doc-optimize-style")) {
    const rest = trimmed.slice("/doc-optimize-style".length).trim();
    const [style, ...instructionParts] = rest.split(/\s+/).filter(Boolean);
    return {
      skill: "doc-optimize-style",
      command: "/doc-optimize-style",
      args: {
        style: style || "professional",
        ...(instructionParts.length > 0
          ? { instructions: instructionParts.join(" ") }
          : {}),
      },
      rawMessage: message,
      docIds,
    };
  }

  if (trimmed.startsWith("/doc-optimize-full")) {
    const rest = trimmed.slice("/doc-optimize-full".length).trim();
    return {
      skill: "doc-optimize-full",
      command: "/doc-optimize-full",
      args: rest ? { instructions: rest } : {},
      rawMessage: message,
      docIds,
    };
  }

  if (trimmed.startsWith("/doc-optimize-ppt-outline")) {
    const rest = trimmed.slice("/doc-optimize-ppt-outline".length).trim();
    return {
      skill: "doc-optimize-ppt-outline",
      command: "/doc-optimize-ppt-outline",
      args: rest ? { instructions: rest } : {},
      rawMessage: message,
      docIds,
    };
  }

  if (trimmed.startsWith("/doc-render-ppt-html")) {
    const rest = trimmed.slice("/doc-render-ppt-html".length).trim();
    return {
      skill: "doc-render-ppt-html",
      command: "/doc-render-ppt-html",
      args: rest ? { theme: rest } : {},
      rawMessage: message,
      docIds,
    };
  }

  if (trimmed.startsWith("/doc-optimize-ppt")) {
    const rest = trimmed.slice("/doc-optimize-ppt".length).trim();
    return {
      skill: "doc-optimize-ppt",
      command: "/doc-optimize-ppt",
      args: rest ? { instructions: rest } : {},
      rawMessage: message,
      docIds,
    };
  }

  if (trimmed.startsWith("/doc-export-ppt")) {
    return {
      skill: "doc-export-ppt",
      command: "/doc-export-ppt",
      args: {},
      rawMessage: message,
      docIds,
    };
  }

  if (trimmed.startsWith("/doc-summary")) {
    return {
      skill: "doc-summary",
      command: "/doc-summary",
      args: {},
      rawMessage: message,
      docIds,
    };
  }

  if (trimmed.startsWith("/doc-move")) {
    const rest = trimmed.slice("/doc-move".length).trim();
    return {
      skill: "doc-move",
      command: "/doc-move",
      args: { target_parent_id: rest || "root" },
      rawMessage: message,
      docIds,
    };
  }

  if (trimmed.startsWith("/doc-delete")) {
    const rest = trimmed.slice("/doc-delete".length).trim();
    return {
      skill: "doc-delete",
      command: "/doc-delete",
      args: { recursive: /\brecursive\b|\b递归\b/.test(rest) },
      rawMessage: message,
      docIds,
    };
  }

  if (trimmed.startsWith("/kb-search")) {
    const rest = trimmed.slice("/kb-search".length).trim();
    return {
      skill: "kb-search",
      command: "/kb-search",
      args: { query: rest },
      rawMessage: message,
      docIds,
    };
  }

  if (trimmed.startsWith("/web-search")) {
    const rest = trimmed.slice("/web-search".length).trim();
    return {
      skill: "web-search",
      command: "/web-search",
      args: { query: rest },
      rawMessage: message,
      docIds,
    };
  }

  if (trimmed.startsWith("/doc-fetch-url")) {
    const rest = trimmed.slice("/doc-fetch-url".length).trim();
    return {
      skill: "doc-fetch-url",
      command: "/doc-fetch-url",
      args: { url: rest },
      rawMessage: message,
      docIds,
    };
  }

  if (trimmed.startsWith("/doc-import-git")) {
    const rest = trimmed.slice("/doc-import-git".length).trim();
    return {
      skill: "doc-import-git",
      command: "/doc-import-git",
      args: { repo_url: rest },
      rawMessage: message,
      docIds,
    };
  }

  if (trimmed.startsWith("/doc-smart-import")) {
    const rest = trimmed.slice("/doc-smart-import".length).trim();
    return {
      skill: "doc-smart-import",
      command: "/doc-smart-import",
      args: { asset_id: rest },
      rawMessage: message,
      docIds,
    };
  }

  if (trimmed.startsWith("/doc-organize")) {
    return {
      skill: "doc-organize",
      command: "/doc-organize",
      args: {},
      rawMessage: message,
      docIds,
    };
  }

  if (trimmed.startsWith("/doc-convert")) {
    const rest = trimmed.slice("/doc-convert".length).trim();
    return {
      skill: "doc-convert",
      command: "/doc-convert",
      args: {
        from: "txt",
        to: "markdown",
        content: rest,
      },
      rawMessage: message,
      docIds,
    };
  }

  if (trimmed.startsWith("/file-parse")) {
    const rest = trimmed.slice("/file-parse".length).trim();
    return {
      skill: "file-parse",
      command: "/file-parse",
      args: { asset_id: rest },
      rawMessage: message,
      docIds,
    };
  }

  if (trimmed.startsWith("/image-analyze")) {
    const rest = trimmed.slice("/image-analyze".length).trim();
    return {
      skill: "image-analyze",
      command: "/image-analyze",
      args: { asset_id: rest },
      rawMessage: message,
      docIds,
    };
  }

  if (trimmed.startsWith("/url-extract")) {
    const rest = trimmed.slice("/url-extract".length).trim();
    return {
      skill: "url-extract",
      command: "/url-extract",
      args: { url: rest },
      rawMessage: message,
      docIds,
    };
  }

  if (trimmed.startsWith("/media-transcribe")) {
    const rest = trimmed.slice("/media-transcribe".length).trim();
    return {
      skill: "media-transcribe",
      command: "/media-transcribe",
      args: parseMediaTranscribeCommandArgs(rest),
      rawMessage: message,
      docIds,
    };
  }

  // No explicit command found
  // Natural language is now handled by analyzeTrigger in trigger.ts
  return null;
}

/**
 * Detect skill intent with enabled status check
 */
export async function detectSkillIntentWithCheck(
  message: string,
  docIds?: string[],
): Promise<SkillIntent | null> {
  const intent = detectSkillIntent(message, docIds);
  if (!intent) {
    return null;
  }

  // Check if the skill is enabled
  const isEnabled = await skillConfigStore.isEnabled(intent.skill);
  if (!isEnabled) {
    return null;
  }

  return intent;
}

/**
 * Extract title from creation request
 */
function extractTitle(message: string): string {
  // Try to extract a quoted title
  const quotedMatch = message.match(/[""「」『』]([^""「」『』]+)[""「」『』]/);
  if (quotedMatch) {
    return quotedMatch[1];
  }

  // Try to extract "关于XXX的文档"
  const aboutMatch = message.match(/关于(.+?)(的|文档|文章|说明)/);
  if (aboutMatch) {
    return aboutMatch[1];
  }

  // Default to a generic title
  return "新文档";
}

/**
 * Execute a skill with streaming output
 */
export async function* executeSkillWithStream(
  userId: string,
  projectKey: string,
  intent: SkillIntent,
  traceContext?: TraceContext,
): AsyncGenerator<SkillStreamChunk> {
  // Create span for skill execution
  const skillSpan = traceContext
    ? traceManager.startSpan(traceContext, `skill:${intent.skill}`, {
        args: intent.args,
        docIds: intent.docIds,
      })
    : null;

  try {
    switch (intent.skill) {
      case "doc-read":
        yield* executeDocRead(userId, projectKey, intent);
        break;
      case "doc-get":
        yield* executeDocGet(userId, projectKey, intent);
        break;
      case "doc-create":
        yield* executeDocCreate(userId, projectKey, intent, traceContext);
        break;
      case "doc-edit":
        yield* executeDocEdit(userId, projectKey, intent, traceContext);
        break;
      case "doc-optimize-format":
        yield* executeDocOptimizeFormat(userId, projectKey, intent, traceContext);
        break;
      case "doc-optimize-content":
        yield* executeDocOptimizeContent(userId, projectKey, intent, traceContext);
        break;
      case "doc-optimize-style":
        yield* executeDocOptimizeStyle(userId, projectKey, intent, traceContext);
        break;
      case "doc-optimize-full":
        yield* executeDocOptimizeFull(userId, projectKey, intent, traceContext);
        break;
      case "doc-optimize-ppt-outline":
        yield* executeDocOptimizePptOutline(userId, projectKey, intent, traceContext);
        break;
      case "doc-render-ppt-html":
        yield* executeDocRenderPptHtml(userId, projectKey, intent, traceContext);
        break;
      case "doc-optimize-ppt":
        yield* executeDocOptimizePpt(userId, projectKey, intent, traceContext);
        break;
      case "doc-export-ppt":
        yield* executeDocExportPpt(userId, projectKey, intent, traceContext);
        break;
      case "doc-summary":
        yield* executeDocSummary(userId, projectKey, intent, traceContext);
        break;
      case "doc-move":
        yield* executeDocMove(userId, projectKey, intent);
        break;
      case "doc-delete":
        yield* executeDocDelete(userId, projectKey, intent);
        break;
      case "kb-search":
        yield* executeKbSearch(userId, projectKey, intent);
        break;
      case "web-search":
        yield* executeWebSearch(userId, projectKey, intent);
        break;
      case "doc-fetch-url":
        yield* executeDocFetchUrl(userId, projectKey, intent);
        break;
      case "doc-import-git":
        yield* executeDocImportGit(userId, projectKey, intent, traceContext);
        break;
      case "doc-smart-import":
        yield* executeDocSmartImport(userId, projectKey, intent, traceContext);
        break;
      case "doc-convert":
        yield* executeDocConvert(userId, projectKey, intent);
        break;
      case "doc-organize":
        yield* executeDocOrganize(userId, projectKey, intent, traceContext);
        break;
      case "file-parse":
        yield* executeFileParse(userId, projectKey, intent, traceContext);
        break;
      case "image-analyze":
        yield* executeImageAnalyze(userId, projectKey, intent, traceContext);
        break;
      case "url-extract":
        yield* executeUrlExtract(userId, projectKey, intent);
        break;
      case "media-transcribe":
        yield* executeMediaTranscribe(userId, projectKey, intent, traceContext);
        break;
      default:
        yield { type: "error", error: `Unknown skill: ${intent.skill}` };
    }
    
    // End skill span successfully
    if (skillSpan) {
      traceManager.endSpan(skillSpan, { status: "completed" });
    }
  } catch (err) {
    // End skill span with error
    if (skillSpan) {
      traceManager.endSpan(skillSpan, { error: err instanceof Error ? err.message : String(err) }, "ERROR");
    }
    throw err;
  }
}

/**
 * Execute doc-create skill
 */
async function* executeDocCreate(
  userId: string,
  projectKey: string,
  intent: SkillIntent,
  traceContext?: TraceContext,
): AsyncGenerator<SkillStreamChunk> {
  const description = String(intent.args.description || intent.args.title || "");
  const parentId = intent.args.parent_id as string | undefined;

  yield { type: "thinking", content: "正在生成文档内容..." };

  try {
    // Get LLM config
    const llmConfig = await configStore.getInternalByType("llm");
    if (!llmConfig) {
      yield { type: "error", error: "LLM 未配置，请先在设置中配置对话模型" };
      return;
    }

    // Build prompt - ask AI to generate both title and content
    const systemPrompt = buildCreateDocumentPrompt();
    const userPrompt = `请根据以下需求创建一个文档：

${description || "创建一个新文档"}

请输出一个 JSON 对象，包含以下字段：
1. "title": 一个简洁、准确的文档标题（不超过 50 个字符）
2. "body": Tiptap JSON 格式的文档正文

输出格式示例：
\`\`\`json
{
  "title": "简洁的标题",
  "body": {
    "type": "doc",
    "content": [...]
  }
}
\`\`\`

请直接输出 JSON，不要添加任何说明文字。`;

    // Generate content with streaming
    let fullContent = "";
    const stream = await llmGateway.chatStream({
      provider: llmConfig.providerId,
      model: llmConfig.defaultModel || "gpt-4o",
      apiKey: llmConfig.apiKey,
      baseUrl: llmConfig.baseUrl,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
      traceContext,
    });

    for await (const chunk of stream.textStream) {
      fullContent += chunk;
      yield { type: "delta", content: chunk };
    }

    // Parse the response to extract title and body
    const { title, body, error: extractError } = extractTitleAndBody(fullContent);
    if (extractError) {
      yield { type: "error", error: extractError };
      return;
    }

    // Validate and process the body content
    const { content: proposedContent, error: parseError } = await parseAndValidateContent(
      JSON.stringify(body),
      projectKey,
      intent,
      llmConfig,
    );

    if (parseError) {
      yield { type: "error", error: parseError };
      return;
    }

    // Create draft with AI-generated title
    const draft = draftService.create({
      userId,
      projectKey,
      docId: null,
      parentId: parentId || null,
      title: title || "新文档",
      originalContent: null,
      proposedContent: proposedContent!,
    });

    yield { type: "draft", draft };
    yield { type: "done", message: "文档草稿已生成" };
  } catch (err) {
    yield {
      type: "error",
      error: `生成文档失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Extract title and body from AI response
 */
function extractTitleAndBody(content: string): { 
  title: string | null; 
  body: JSONContent | null; 
  error: string | null;
} {
  try {
    // Try to extract JSON from markdown code block
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : content.trim();
    
    const parsed = JSON.parse(jsonStr);
    
    if (typeof parsed !== "object" || parsed === null) {
      return { title: null, body: null, error: "AI 返回的不是有效的 JSON 对象" };
    }

    const title = typeof parsed.title === "string" ? parsed.title.trim() : null;
    const body = parsed.body;

    if (!body || typeof body !== "object") {
      // Maybe the AI returned just the body without wrapper
      if (parsed.type === "doc" && Array.isArray(parsed.content)) {
        return { title: title || "新文档", body: parsed as JSONContent, error: null };
      }
      return { title: null, body: null, error: "AI 返回的 JSON 缺少 body 字段" };
    }

    if (body.type !== "doc" || !Array.isArray(body.content)) {
      return { title: null, body: null, error: "AI 返回的 body 不是有效的文档格式" };
    }

    return { title: title || "新文档", body: body as JSONContent, error: null };
  } catch (err) {
    return { 
      title: null, 
      body: null, 
      error: `解析 AI 返回内容失败: ${err instanceof Error ? err.message : String(err)}` 
    };
  }
}

/**
 * Execute doc-edit skill
 */
async function* executeDocEdit(
  userId: string,
  projectKey: string,
  intent: SkillIntent,
  traceContext?: TraceContext,
): AsyncGenerator<SkillStreamChunk> {
  if (!intent.docIds || intent.docIds.length === 0) {
    yield { type: "error", error: "请使用 @ 指定要编辑的文档" };
    return;
  }

  const docId = intent.docIds[0];
  const instructions = String(intent.args.instructions || intent.rawMessage);

  yield { type: "thinking", content: "正在读取原文档..." };

  try {
    // Get original document
    const doc = await documentStore.get(userId, projectKey, docId);
    const originalContent = doc.body.type === "markdown" && typeof doc.body.content === "string"
      ? markdownToTiptapJson(doc.body.content)
      : extractTiptapDoc(doc.body);
    const originalMarkdown = tiptapJsonToMarkdown(originalContent);

    yield { type: "thinking", content: "正在生成修改内容..." };

    // Get LLM config
    const llmConfig = await configStore.getInternalByType("llm");
    if (!llmConfig) {
      yield { type: "error", error: "LLM 未配置，请先在设置中配置对话模型" };
      return;
    }

    // Build prompt
    const systemPrompt = buildEditDocumentPrompt();
    const userPrompt = `原始文档内容（Markdown 格式）：

\`\`\`markdown
${originalMarkdown}
\`\`\`

修改要求：${instructions}

请根据修改要求，输出修改后的完整文档正文（Tiptap JSON 格式）。保留原有的 block id，为新增内容生成新的 id。`;

    // Generate content with streaming
    let fullContent = "";
    const stream = await llmGateway.chatStream({
      provider: llmConfig.providerId,
      model: llmConfig.defaultModel || "gpt-4o",
      apiKey: llmConfig.apiKey,
      baseUrl: llmConfig.baseUrl,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
      traceContext,
    });

    for await (const chunk of stream.textStream) {
      fullContent += chunk;
      yield { type: "delta", content: chunk };
    }

    // Parse and validate content
    const { content: proposedContent, error: parseError } = await parseAndValidateContent(
      fullContent,
      projectKey,
      intent,
      llmConfig,
    );

    if (parseError) {
      yield { type: "error", error: parseError };
      return;
    }

    // Create draft
    const draft = draftService.create({
      userId,
      projectKey,
      docId,
      parentId: doc.meta.parent_id || null,
      title: doc.meta.title,
      originalContent,
      proposedContent: proposedContent!,
    });

    yield { type: "draft", draft };
    yield { type: "done", message: "文档修改草稿已生成" };
  } catch (err) {
    yield {
      type: "error",
      error: `编辑文档失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Execute doc optimization capability
 */
async function* executeDocOptimize(
  userId: string,
  projectKey: string,
  intent: SkillIntent,
  capabilityId: OptimizeCapabilityId,
  traceContext?: TraceContext,
): AsyncGenerator<SkillStreamChunk> {
  if (!intent.docIds || intent.docIds.length === 0) {
    yield { type: "error", error: "请使用 @ 指定要优化的文档" };
    return;
  }

  yield { type: "thinking", content: "正在读取文档内容..." };

  try {
    const capability = getOptimizeCapability(capabilityId);
    // runDraftRefinementLoop may append feedback into `input` when `instructions` is absent.
    const instructions = typeof intent.args.instructions === "string"
      ? intent.args.instructions
      : typeof intent.args.input === "string"
        ? intent.args.input
        : undefined;
    const args = {
      docId: intent.docIds[0],
      instructions,
      style: typeof intent.args.style === "string" ? intent.args.style : undefined,
    };

    for await (const chunk of runDocOptimize({
      userId,
      projectKey,
      capabilityId,
      args,
      traceContext,
    })) {
      if (chunk.type === "thinking" || chunk.type === "delta") {
        yield chunk;
        continue;
      }

      if (chunk.type === "result") {
        const draft = draftService.create({
          userId,
          projectKey,
          docId: chunk.result.docId,
          parentId: chunk.result.parentId,
          title: chunk.result.title,
          originalContent: chunk.result.originalContent,
          proposedContent: chunk.result.proposedContent,
        });
        yield { type: "draft", draft };
        yield { type: "done", message: capability.outputMessage };
      }
    }
  } catch (err) {
    yield {
      type: "error",
      error: `${getOptimizeCapability(capabilityId).description}失败: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}

/**
 * Execute doc-optimize-format skill
 */
async function* executeDocOptimizeFormat(
  userId: string,
  projectKey: string,
  intent: SkillIntent,
  traceContext?: TraceContext,
): AsyncGenerator<SkillStreamChunk> {
  yield* executeDocOptimize(userId, projectKey, intent, "doc-optimize-format", traceContext);
}

/**
 * Execute doc-optimize-content skill
 */
async function* executeDocOptimizeContent(
  userId: string,
  projectKey: string,
  intent: SkillIntent,
  traceContext?: TraceContext,
): AsyncGenerator<SkillStreamChunk> {
  yield* executeDocOptimize(userId, projectKey, intent, "doc-optimize-content", traceContext);
}

/**
 * Execute doc-optimize-style skill
 */
async function* executeDocOptimizeStyle(
  userId: string,
  projectKey: string,
  intent: SkillIntent,
  traceContext?: TraceContext,
): AsyncGenerator<SkillStreamChunk> {
  yield* executeDocOptimize(userId, projectKey, intent, "doc-optimize-style", traceContext);
}

/**
 * Execute doc-optimize-full skill
 */
async function* executeDocOptimizeFull(
  userId: string,
  projectKey: string,
  intent: SkillIntent,
  traceContext?: TraceContext,
): AsyncGenerator<SkillStreamChunk> {
  yield* executeDocOptimize(userId, projectKey, intent, "doc-optimize-full", traceContext);
}

// ============================================================================
// PPT-Style Deck Skill
// ============================================================================

const PPT_SOURCE_MARKDOWN_MAX_LEN = 30_000;

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string"
      ? Number.parseInt(value, 10)
      : Number.NaN;
  const n = Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizeDeckTitle(raw: string): string {
  const title = raw.trim();
  if (!title) return "演示稿（PPT）";
  if (/(\(ppt\)|（ppt）)/i.test(title)) return title;
  return `${title}（PPT）`;
}

/**
 * Execute doc-optimize-ppt (compat alias)
 */
async function* executeDocOptimizePpt(
  userId: string,
  projectKey: string,
  intent: SkillIntent,
  traceContext?: TraceContext,
): AsyncGenerator<SkillStreamChunk> {
  yield* executeDocOptimizePptOutlineCore(
    userId,
    projectKey,
    intent,
    traceContext,
    buildPptOptimizeDocumentPrompt,
    "演示稿草稿已生成",
  );
}

/**
 * Execute doc-optimize-ppt-outline (Step 1)
 */
async function* executeDocOptimizePptOutline(
  userId: string,
  projectKey: string,
  intent: SkillIntent,
  traceContext?: TraceContext,
): AsyncGenerator<SkillStreamChunk> {
  yield* executeDocOptimizePptOutlineCore(
    userId,
    projectKey,
    intent,
    traceContext,
    buildPptOutlineDocumentPrompt,
    "结构化类 PPT 文档草稿已生成",
  );
}

async function* executeDocOptimizePptOutlineCore(
  userId: string,
  projectKey: string,
  intent: SkillIntent,
  traceContext: TraceContext | undefined,
  promptBuilder: () => string,
  doneMessage: string,
): AsyncGenerator<SkillStreamChunk> {
  const explicitDocId = typeof intent.args.doc_id === "string" ? intent.args.doc_id.trim() : "";
  const scopedDocId = intent.docIds && intent.docIds.length > 0 ? intent.docIds[0] : "";
  const docId = explicitDocId || scopedDocId;

  if (!docId) {
    yield { type: "error", error: "请使用 @ 指定要生成演示稿的文档" };
    return;
  }

  yield { type: "thinking", content: "正在读取源文档..." };

  try {
    const doc = await documentStore.get(userId, projectKey, docId);
    const originalContent = doc.body.type === "markdown" && typeof doc.body.content === "string"
      ? markdownToTiptapJson(doc.body.content)
      : extractTiptapDoc(doc.body);
    const originalMarkdownFull = tiptapJsonToMarkdown(originalContent);
    const originalMarkdown = originalMarkdownFull.length > PPT_SOURCE_MARKDOWN_MAX_LEN
      ? `${originalMarkdownFull.slice(0, PPT_SOURCE_MARKDOWN_MAX_LEN)}

[内容已截断]`
      : originalMarkdownFull;

    const args = intent.args || {};

    const deckTitleRaw = typeof args.title === "string" && args.title.trim()
      ? args.title.trim()
      : String(doc.meta.title || "演示稿");
    const deckTitle = normalizeDeckTitle(deckTitleRaw);

    const presenter = typeof args.presenter === "string" && args.presenter.trim()
      ? args.presenter.trim()
      : "待填写";

    const reportTime = typeof args.report_time === "string" && args.report_time.trim()
      ? args.report_time.trim()
      : new Date().toISOString().slice(0, 10);

    const maxSlides = clampInt(args.max_slides, 12, 5, 20);

    const includeAgenda = typeof args.include_agenda === "boolean" ? args.include_agenda : true;
    const includeQna = typeof args.include_qna === "boolean" ? args.include_qna : true;

    const extraInstructions = typeof args.instructions === "string"
      ? args.instructions.trim()
      : typeof args.input === "string"
        ? args.input.trim()
        : "";

    const llmConfig = await configStore.getInternalByType("llm");
    if (!llmConfig) {
      yield { type: "error", error: "LLM 未配置，请先在设置中配置对话模型" };
      return;
    }

    yield { type: "thinking", content: "正在生成结构化类 PPT 文档草稿..." };

    const systemPrompt = promptBuilder();
    const userPrompt = `源文档标题: ${doc.meta.title}

演示稿参数:
- deck_title: ${deckTitleRaw}
- presenter: ${presenter}
- report_time: ${reportTime}
- max_slides: ${maxSlides}
- include_agenda: ${includeAgenda}
- include_qna: ${includeQna}

额外要求:
${extraInstructions || "无"}

源文档内容（Markdown，可能被截断）:
\`\`\`markdown
${originalMarkdown}
\`\`\`

请输出“结构化类 PPT 说明文档”的完整文档正文（Tiptap JSON，type=doc）。`;

    let fullContent = "";
    const stream = await llmGateway.chatStream({
      provider: llmConfig.providerId,
      model: llmConfig.defaultModel || "gpt-4o",
      apiKey: llmConfig.apiKey,
      baseUrl: llmConfig.baseUrl,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.35,
      traceContext,
    });

    for await (const chunk of stream.textStream) {
      fullContent += chunk;
      yield { type: "delta", content: chunk };
    }

    const { content: proposedContent, error: parseError } = await parseAndValidateContent(
      fullContent,
      projectKey,
      intent,
      llmConfig,
    );

    if (parseError) {
      yield { type: "error", error: parseError };
      return;
    }

    const draft = draftService.create({
      userId,
      projectKey,
      docId: null,
      parentId: doc.meta.parent_id || null,
      title: deckTitle,
      originalContent: null,
      proposedContent: proposedContent!,
    });

    yield { type: "draft", draft };
    yield { type: "done", message: doneMessage };
  } catch (err) {
    yield {
      type: "error",
      error: `生成演示稿失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

const PPT_HTML_SOURCE_MARKDOWN_MAX_LEN = 40_000;

function parseJsonObjectFromText(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    // ignore
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      const parsed = JSON.parse(fenced[1].trim());
      return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
    } catch {
      // ignore
    }
  }

  const startIdx = trimmed.indexOf("{");
  const endIdx = trimmed.lastIndexOf("}");
  if (startIdx !== -1 && endIdx > startIdx) {
    try {
      const parsed = JSON.parse(trimmed.slice(startIdx, endIdx + 1));
      return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }

  return null;
}

function parsePptHtmlModelResponse(raw: string): { model?: PptHtmlModel; error?: string } {
  const parsed = parseJsonObjectFromText(raw);
  if (!parsed) {
    return { error: "无法解析 PPT HTML 模型 JSON" };
  }

  const model = normalizePptHtmlModel(parsed);
  if (!model.slides || model.slides.length === 0) {
    return { error: "PPT HTML 模型缺少有效 slides" };
  }

  return { model };
}

function sanitizeHtmlFilename(rawTitle: string): string {
  const base = rawTitle
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9一-龥_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return base || "presentation";
}

function isAutoGeneratedPptHtmlFileBlock(node: JSONContent): boolean {
  if (!node || node.type !== "file_block") return false;
  const attrs = node.attrs as Record<string, unknown> | undefined;
  if (!attrs) return false;

  const mime = typeof attrs.mime === "string" ? attrs.mime.toLowerCase() : "";
  const fileName = typeof attrs.file_name === "string" ? attrs.file_name.toLowerCase() : "";
  return mime === "text/html" && fileName.startsWith("ppt-preview-");
}

function injectPptHtmlFileBlockAtTop(original: JSONContent, fileBlock: JSONContent): JSONContent {
  const content = Array.isArray(original.content) ? original.content : [];
  const filtered = content.filter((node) => !isAutoGeneratedPptHtmlFileBlock(node));

  return ensureBlockIds({
    type: "doc",
    content: [fileBlock, ...filtered],
  } as unknown as JSONContent) as JSONContent;
}

/**
 * Execute doc-render-ppt-html skill (Step 2)
 */
async function* executeDocRenderPptHtml(
  userId: string,
  projectKey: string,
  intent: SkillIntent,
  traceContext?: TraceContext,
): AsyncGenerator<SkillStreamChunk> {
  const explicitDocId = typeof intent.args.doc_id === "string" ? intent.args.doc_id.trim() : "";
  const scopedDocId = intent.docIds && intent.docIds.length > 0 ? intent.docIds[0] : "";
  const docId = explicitDocId || scopedDocId;

  if (!docId) {
    yield { type: "error", error: "请使用 @ 指定目标文档，或提供 doc_id" };
    return;
  }

  const themeRaw = typeof intent.args.theme === "string" ? intent.args.theme.trim().toLowerCase() : "";
  const theme = ["modern", "business", "minimal", "dark"].includes(themeRaw)
    ? themeRaw
    : "modern";

  yield { type: "thinking", content: "正在读取结构化类 PPT 文档..." };

  try {
    const doc = await documentStore.get(userId, projectKey, docId);
    const originalDoc = extractTiptapDoc(doc.body);
    const markdownFull = tiptapJsonToMarkdown(originalDoc);
    const markdown = markdownFull.length > PPT_HTML_SOURCE_MARKDOWN_MAX_LEN
      ? `${markdownFull.slice(0, PPT_HTML_SOURCE_MARKDOWN_MAX_LEN)}

[内容已截断]`
      : markdownFull;

    const llmConfig = await configStore.getInternalByType("llm");
    if (!llmConfig) {
      yield { type: "error", error: "LLM 未配置，请先在设置中配置对话模型" };
      return;
    }

    yield { type: "thinking", content: "正在生成 HTML 演示稿模型..." };

    const modelResponse = await llmGateway.chat({
      provider: llmConfig.providerId,
      model: llmConfig.defaultModel || "gpt-4o",
      apiKey: llmConfig.apiKey,
      baseUrl: llmConfig.baseUrl,
      messages: [
        { role: "system", content: buildPptHtmlModelPrompt() },
        {
          role: "user",
          content: `请根据以下结构化类 PPT 文档，生成渲染模型 JSON。

文档标题: ${doc.meta.title}

文档内容（Markdown）:
\`\`\`markdown
${markdown}
\`\`\``,
        },
      ],
      temperature: 0.2,
      maxTokens: 2000,
      traceContext,
    });

    const { model, error: modelError } = parsePptHtmlModelResponse(modelResponse.content || "");
    if (!model || modelError) {
      yield { type: "error", error: modelError || "PPT HTML 模型生成失败" };
      return;
    }

    yield { type: "thinking", content: "正在渲染静态 HTML 并注入 file_block..." };

    const html = sanitizePptHtml(renderPptHtmlFromModel(model, { theme }));
    const filename = `ppt-preview-${sanitizeHtmlFilename(doc.meta.title)}-${Date.now()}.html`;

    const assetMeta = await assetStore.save(
      userId,
      projectKey,
      filename,
      "text/html",
      Buffer.from(html, "utf-8"),
    );

    const htmlFileBlock = buildFileBlockNode({
      id: assetMeta.id,
      filename: assetMeta.filename,
      mime: assetMeta.mime,
      size: assetMeta.size,
    });

    const proposedContent = injectPptHtmlFileBlockAtTop(originalDoc, htmlFileBlock);

    const draft = draftService.create({
      userId,
      projectKey,
      docId: doc.meta.id,
      parentId: doc.meta.parent_id || null,
      title: doc.meta.title,
      originalContent: originalDoc,
      proposedContent,
    });

    yield { type: "draft", draft };
    yield {
      type: "done",
      message: `HTML 演示稿已生成并注入文档顶部（doc_id=${doc.meta.id}, asset_id=${assetMeta.id}）。`,
    };
  } catch (err) {
    yield {
      type: "error",
      error: `生成 HTML 演示稿失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Execute doc-export-ppt skill
 *
 * Triggers async PPT generation and returns task id/status for follow-up polling/downloading.
 */
async function* executeDocExportPpt(
  userId: string,
  projectKey: string,
  intent: SkillIntent,
  traceContext?: TraceContext,
): AsyncGenerator<SkillStreamChunk> {
  const explicitDocId = typeof intent.args.doc_id === "string" ? intent.args.doc_id.trim() : "";
  const scopeDocId = intent.docIds && intent.docIds.length > 0 ? intent.docIds[0] : "";
  const docId = explicitDocId || scopeDocId;

  if (!docId) {
    yield { type: "error", error: "请使用 @ 指定要导出的文档，或提供 doc_id" };
    return;
  }

  yield { type: "thinking", content: "正在准备导出 PPT 任务..." };

  try {
    const doc = await documentStore.get(userId, projectKey, docId);
    const body = extractTiptapDoc(doc.body);

    const available = await pptService.isAvailable();
    if (!available) {
      yield { type: "error", error: "PPT 导出服务暂不可用，请稍后重试" };
      return;
    }

    const style = intent.args.style && typeof intent.args.style === "object"
      ? intent.args.style as Record<string, unknown>
      : undefined;

    const options = intent.args.options && typeof intent.args.options === "object"
      ? intent.args.options as Record<string, unknown>
      : undefined;

    const result = await pptService.generateFromDocument(
      body,
      style as {
        description?: string;
        templateId?: string;
        templateImages?: string[];
      } | undefined,
      options as {
        aspectRatio?: "16:9" | "4:3";
        language?: string;
      } | undefined,
    );

    yield {
      type: "done",
      message: `PPT 导出任务已创建（doc_id=${docId}, task_id=${result.taskId}, status=${result.status}）。可稍后查询任务状态并下载。`,
    };
  } catch (err) {
    yield {
      type: "error",
      error: `导出 PPT 失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ============================================================================
// Document Summary Skill
// ============================================================================

// Summary skill constants
const SUMMARY_MAX_DOCS = 30; // Maximum documents to process in directory mode
const SUMMARY_MAX_DEPTH = 5; // Maximum recursion depth for directory mode
const SUMMARY_MAX_CONTENT_LEN = 500; // Maximum content length per document

/**
 * Execute doc-summary skill
 * 
 * Supports two modes:
 * 1. Single document: Generate summary for a single document
 * 2. Directory: Recursively summarize all child documents
 */
async function* executeDocSummary(
  userId: string,
  projectKey: string,
  intent: SkillIntent,
  traceContext?: TraceContext,
): AsyncGenerator<SkillStreamChunk> {
  // 1. Validate document ID
  if (!intent.docIds || intent.docIds.length === 0) {
    yield { type: "error", error: "请使用 @ 指定要生成摘要的文档" };
    return;
  }

  const docId = intent.docIds[0];

  yield { type: "thinking", content: "正在读取文档信息..." };

  try {
    // 2. Read target document
    const doc = await documentStore.get(userId, projectKey, docId);
    
    // Extract the actual document content (handle nested structure)
    const originalContent = extractDocContent(doc.body);

    // 3. Check if already has a summary block at top
    const existingSummary = checkExistingSummary(originalContent);
    if (existingSummary) {
      yield { type: "thinking", content: `检测到已有摘要，将进行替换...` };
    }

    // 4. Check if has children (determine if directory or single document)
    const children = await documentStore.getChildren(userId, projectKey, docId);
    const isDirectory = children.length > 0;

    let summaryBlock: JSONContent;

    // Prepare typed doc for summary generation (use extracted content)
    const typedDoc = {
      meta: { title: doc.meta.title },
      body: originalContent,
    };

    if (isDirectory) {
      // Directory mode with progress feedback
      yield { type: "thinking", content: `正在读取目录下的文档 (${children.length} 个直接子文档)...` };
      
      // Pass a progress callback generator
      const progressCallback = async function*(msg: string) {
        yield { type: "thinking" as const, content: msg };
      };
      
      summaryBlock = await generateDirectorySummaryWithProgress(
        userId,
        projectKey, 
        docId, 
        typedDoc, 
        intent,
        progressCallback,
      );
    } else {
      // Single document mode
      yield { type: "thinking", content: "正在生成文档摘要..." };
      summaryBlock = await generateDocumentSummary(typedDoc, intent);
    }

    // 5. Insert summary at document top (preserving original content)
    const newContent = insertSummaryAtTop(originalContent, summaryBlock);

    // 6. Create draft
    const draft = draftService.create({
      userId,
      projectKey,
      docId,
      parentId: doc.meta.parent_id || null,
      title: doc.meta.title,
      originalContent,
      proposedContent: newContent,
    });

    yield { type: "draft", draft };
    yield { 
      type: "done", 
      message: isDirectory 
        ? `目录摘要已生成${existingSummary ? "（已替换原摘要）" : ""}` 
        : `文档摘要已生成${existingSummary ? "（已替换原摘要）" : ""}` 
    };
  } catch (err) {
    yield {
      type: "error",
      error: `生成摘要失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Extract the actual document content from potentially nested body structure
 * Handles both { type: "doc", content: [...] } and { type: "tiptap", content: { type: "doc", content: [...] } }
 */
function extractDocContent(body: unknown): JSONContent {
  if (body && typeof body === "object") {
    const raw = body as { type?: unknown; content?: unknown };
    if (raw.type === "markdown" && typeof raw.content === "string") {
      return markdownToTiptapJson(raw.content);
    }
  }

  return extractTiptapDoc(body);
}

/**
 * Check if the document already has a summary block at the top
 */
function checkExistingSummary(content: JSONContent): boolean {
  if (content.type !== "doc" || !Array.isArray(content.content) || content.content.length === 0) {
    return false;
  }
  
  const firstBlock = content.content[0];
  if (firstBlock.type !== "blockquote") return false;
  
  const firstPara = (firstBlock.content as JSONContent[] | undefined)?.[0];
  if (firstPara?.type !== "paragraph") return false;
  
  const firstText = (firstPara.content as JSONContent[] | undefined)?.[0];
  if (firstText?.type !== "text") return false;
  
  const text = (firstText as { text?: string }).text || "";
  return text.startsWith("📝 摘要：") || text.startsWith("📁 目录摘要：");
}

/**
 * Generate summary for a single document
 */
async function generateDocumentSummary(
  doc: { meta: { title: string }; body: JSONContent },
  _intent: SkillIntent,
): Promise<JSONContent> {
  // Ensure content is properly extracted
  const content = doc.body.type === "doc" ? doc.body : extractDocContent(doc.body);
  const markdown = tiptapJsonToMarkdown(content);

  // Get LLM config
  const llmConfig = await configStore.getInternalByType("llm");
  if (!llmConfig) {
    throw new Error("LLM 未配置，请先在设置中配置对话模型");
  }

  const prompt = `请为以下文档生成一个简洁的摘要（2-3句话）。

文档标题：${doc.meta.title}
文档内容：
${markdown}

要求：
- 以"📝 摘要："开头
- 突出核心主题和关键信息
- 使用客观专业的语言
- 直接输出摘要文本，不要添加任何其他格式或说明`;

  const response = await llmGateway.chat({
    provider: llmConfig.providerId,
    model: llmConfig.defaultModel || "gpt-4o",
    apiKey: llmConfig.apiKey,
    baseUrl: llmConfig.baseUrl,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.5,
  });

  const summaryText = response.content.trim();
  return buildSummaryBlock(summaryText);
}

/**
 * Recursively collect descendant IDs with depth limit
 */
async function collectDescendantsWithLimit(
  userId: string,
  projectKey: string,
  parentId: string,
  maxDepth: number,
  currentDepth = 0,
): Promise<string[]> {
  if (currentDepth >= maxDepth) {
    return [];
  }
  
  const children = await documentStore.getChildren(userId, projectKey, parentId);
  const ids: string[] = [];
  
  for (const child of children) {
    ids.push(child.id);
    // Recursively collect descendants with depth tracking
    const descendants = await collectDescendantsWithLimit(
      userId,
      projectKey, 
      child.id, 
      maxDepth, 
      currentDepth + 1
    );
    ids.push(...descendants);
  }
  
  return ids;
}

/**
 * Generate summary for a directory and all its child documents
 * With progress feedback support
 */
async function generateDirectorySummaryWithProgress(
  userId: string,
  projectKey: string,
  dirId: string,
  dirDoc: { meta: { title: string }; body: JSONContent },
  _intent: SkillIntent,
  _progressCallback?: (msg: string) => AsyncGenerator<SkillStreamChunk>,
): Promise<JSONContent> {
  // Recursively collect descendant IDs with depth limit
  const allDescendantIds = await collectDescendantsWithLimit(
    userId,
    projectKey, 
    dirId, 
    SUMMARY_MAX_DEPTH
  );

  // Read all child document contents (with limit)
  const docSummaries: Array<{ title: string; content: string }> = [];
  const totalToProcess = Math.min(allDescendantIds.length, SUMMARY_MAX_DOCS);
  
  for (let i = 0; i < totalToProcess; i++) {
    const id = allDescendantIds[i];
    try {
      const childDoc = await documentStore.get(userId, projectKey, id);
      // Extract content properly
      const extractedContent = extractDocContent(childDoc.body as JSONContent);
      const markdown = tiptapJsonToMarkdown(extractedContent);
      docSummaries.push({
        title: childDoc.meta.title,
        content: markdown.slice(0, SUMMARY_MAX_CONTENT_LEN),
      });
    } catch {
      // Skip documents that fail to load
    }
  }

  // Get LLM config
  const llmConfig = await configStore.getInternalByType("llm");
  if (!llmConfig) {
    throw new Error("LLM 未配置，请先在设置中配置对话模型");
  }

  const limitNote = allDescendantIds.length > SUMMARY_MAX_DOCS 
    ? `（共 ${allDescendantIds.length} 个，仅处理前 ${SUMMARY_MAX_DOCS} 个，最大深度 ${SUMMARY_MAX_DEPTH} 层）` 
    : "";

  const prompt = `请为以下目录生成一个整体摘要。

目录标题：${dirDoc.meta.title}
包含 ${docSummaries.length} 个文档${limitNote}：

${docSummaries.map((d, i) => `${i + 1}. ${d.title}\n${d.content}`).join("\n\n---\n\n")}

要求：
1. 先输出一个整体摘要（以"📁 目录摘要："开头）
2. 然后列出每个文档的一句话概述
3. 使用 JSON 格式输出：
\`\`\`json
{
  "overview": "📁 目录摘要：...",
  "documents": [
    { "title": "文档标题", "summary": "一句话概述" },
    ...
  ]
}
\`\`\``;

  const response = await llmGateway.chat({
    provider: llmConfig.providerId,
    model: llmConfig.defaultModel || "gpt-4o",
    apiKey: llmConfig.apiKey,
    baseUrl: llmConfig.baseUrl,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.5,
  });

  return buildDirectorySummaryBlock(response.content);
}

/**
 * Build summary block for a single document
 */
function buildSummaryBlock(summaryText: string): JSONContent {
  return {
    type: "blockquote",
    attrs: { id: uuidv4() },
    content: [
      {
        type: "paragraph",
        attrs: { id: uuidv4() },
        content: [
          {
            type: "text",
            text: summaryText,
            marks: [{ type: "bold" }],
          },
        ],
      },
    ],
  };
}

/**
 * Build summary block for a directory (with document list)
 */
function buildDirectorySummaryBlock(jsonResponse: string): JSONContent {
  // Try to extract JSON from the response
  let parsed: { overview: string; documents: Array<{ title: string; summary: string }> };
  
  try {
    // Try to extract JSON from markdown code block
    const jsonMatch = jsonResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : jsonResponse.trim();
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    // Fallback: use response as overview
    console.warn("[buildDirectorySummaryBlock] Failed to parse JSON:", err);
    return buildSummaryBlock(`📁 目录摘要：${jsonResponse.slice(0, 200)}...`);
  }

  const listItems = (parsed.documents || []).map((doc) => ({
    type: "listItem" as const,
    attrs: { id: uuidv4() },
    content: [
      {
        type: "paragraph" as const,
        attrs: { id: uuidv4() },
        content: [{ type: "text" as const, text: `${doc.title}：${doc.summary}` }],
      },
    ],
  }));

  const content: JSONContent[] = [
    {
      type: "paragraph",
      attrs: { id: uuidv4() },
      content: [
        {
          type: "text",
          text: parsed.overview || "📁 目录摘要：",
          marks: [{ type: "bold" }],
        },
      ],
    },
  ];

  if (listItems.length > 0) {
    content.push({
      type: "bulletList",
      attrs: { id: uuidv4() },
      content: listItems,
    } as JSONContent);
  }

  return {
    type: "blockquote",
    attrs: { id: uuidv4() },
    content,
  };
}

/**
 * Insert summary block at the top of document content
 */
function insertSummaryAtTop(originalContent: JSONContent, summaryBlock: JSONContent): JSONContent {
  // Log input for debugging
  console.log("[insertSummaryAtTop] originalContent.type:", originalContent?.type);
  console.log("[insertSummaryAtTop] originalContent.content length:", Array.isArray(originalContent?.content) ? originalContent.content.length : "not array");
  
  // Ensure the content is in the correct format
  if (originalContent.type !== "doc" || !Array.isArray(originalContent.content)) {
    console.warn("[insertSummaryAtTop] Invalid originalContent structure, attempting to extract content");
    
    // Try to extract content if it's wrapped in unexpected structure
    let extractedContent: JSONContent[] = [];
    if (Array.isArray(originalContent?.content)) {
      extractedContent = originalContent.content as JSONContent[];
    } else if (originalContent?.content && typeof originalContent.content === "object") {
      // Maybe content is a single block, wrap it in array
      extractedContent = [originalContent.content as JSONContent];
    }
    
    if (extractedContent.length === 0) {
      console.warn("[insertSummaryAtTop] Could not extract original content, returning summary only");
      return {
        type: "doc",
        content: [summaryBlock],
      };
    }
    
    // Return summary + extracted content
    return {
      type: "doc",
      content: [summaryBlock, ...extractedContent],
    };
  }

  // Check if there's already a summary block at the top (blockquote starting with 📝 or 📁)
  const existingSummaryIdx = originalContent.content.findIndex((block) => {
    if (block.type !== "blockquote") return false;
    const firstPara = (block.content as JSONContent[] | undefined)?.[0];
    if (firstPara?.type !== "paragraph") return false;
    const firstText = (firstPara.content as JSONContent[] | undefined)?.[0];
    if (firstText?.type !== "text") return false;
    const text = (firstText as { text?: string }).text || "";
    return text.startsWith("📝 摘要：") || text.startsWith("📁 目录摘要：");
  });

  let newContent: JSONContent[];
  if (existingSummaryIdx !== -1) {
    // Replace existing summary
    console.log("[insertSummaryAtTop] Replacing existing summary at index:", existingSummaryIdx);
    newContent = [...originalContent.content];
    newContent[existingSummaryIdx] = summaryBlock;
  } else {
    // Insert at top
    console.log("[insertSummaryAtTop] Inserting summary at top, preserving", originalContent.content.length, "original blocks");
    newContent = [summaryBlock, ...originalContent.content];
  }

  console.log("[insertSummaryAtTop] Result content length:", newContent.length);
  return {
    type: "doc",
    content: newContent,
  };
}

// ============================================================================
// Integration Skills (organize / search / fetch / import / convert)
// ============================================================================
//
// Implemented in ./native/integration-skills.ts to keep this executor focused on
// core doc-editing loops and dispatch.

// ============================================================================
// Parse Skills (file-parse, image-analyze, media-transcribe, url-extract)
// ============================================================================

/**
 * Parse and validate LLM output content
 */
async function parseAndValidateContent(
  rawContent: string,
  projectKey: string,
  intent: SkillIntent,
  llmConfig: { providerId: string; defaultModel?: string; apiKey?: string; baseUrl?: string },
  retryCount = 0,
): Promise<{ content?: JSONContent; error?: string }> {
  // Try to extract JSON from the response
  let jsonContent: JSONContent | null = null;
  let parseError: string | null = null;

  try {
    // Try direct parse first
    jsonContent = JSON.parse(rawContent);
  } catch {
    // Try to extract JSON from markdown code blocks
    const jsonMatch = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        jsonContent = JSON.parse(jsonMatch[1].trim());
      } catch (e) {
        parseError = `JSON 解析失败: ${e instanceof Error ? e.message : String(e)}`;
      }
    } else {
      // Try to find JSON-like content
      const jsonStart = rawContent.indexOf("{");
      const jsonEnd = rawContent.lastIndexOf("}");
      if (jsonStart !== -1 && jsonEnd > jsonStart) {
        try {
          jsonContent = JSON.parse(rawContent.slice(jsonStart, jsonEnd + 1));
        } catch (e) {
          parseError = `JSON 解析失败: ${e instanceof Error ? e.message : String(e)}`;
        }
      } else {
        parseError = "未找到有效的 JSON 内容";
      }
    }
  }

  if (!jsonContent && parseError) {
    // If we can't parse JSON, try to convert as markdown
    try {
      console.log("[SkillExecutor] Falling back to markdown conversion");
      jsonContent = markdownToTiptapJson(rawContent);
    } catch {
      // If markdown conversion also fails, retry with LLM
      if (retryCount < MAX_RETRIES) {
        console.log(`[SkillExecutor] Retrying with error feedback (attempt ${retryCount + 1})`);
        // Would need to regenerate with error feedback - simplified for now
        return { error: parseError };
      }
      return { error: parseError };
    }
  }

  if (!jsonContent) {
    return { error: "无法解析 LLM 输出内容" };
  }

  // Validate content
  const validation = validateTiptapContent(jsonContent);
  if (!validation.valid) {
    console.warn("[SkillExecutor] Validation issues:", validation.errors);
    
    // Try to fix common issues
    const fixed = fixCommonIssues(jsonContent);
    const revalidation = validateTiptapContent(fixed);
    
    if (revalidation.valid) {
      return { content: fixed };
    }
    
    // If still invalid after fixes, retry with feedback
    if (retryCount < MAX_RETRIES) {
      console.log(`[SkillExecutor] Content invalid after fixes, would retry...`);
      // Simplified - would regenerate with error feedback
    }
    
    // Return anyway with a warning
    console.warn("[SkillExecutor] Returning content with validation warnings");
    return { content: fixed };
  }

  return { content: jsonContent };
}

/**
 * Check if a message contains skill triggers
 */
export function hasSkillTrigger(message: string): boolean {
  return detectSkillIntent(message) !== null;
}

/**
 * Get available skill commands (async, only returns enabled skills)
 */
export async function getAvailableSkillCommands(): Promise<Array<{
  command: string;
  name: string;
  description: string;
  category: string;
}>> {
  const enabledSkills = await skillConfigStore.getEnabledSkillDefinitions();
  return enabledSkills.map((skill) => ({
    command: skill.command,
    name: skill.name,
    description: skill.description,
    category: skill.category,
  }));
}

/**
 * Get all skill commands (sync, returns all skills regardless of enabled status)
 */
export function getAllSkillCommands(): Array<{
  command: string;
  name: string;
  description: string;
  category: string;
}> {
  const allSkills = skillConfigStore.getAllSkillDefinitions();
  return allSkills.map((skill) => ({
    command: skill.command,
    name: skill.name,
    description: skill.description,
    category: skill.category,
  }));
}

// ============================================================================
// Anthropic Skills Execution (LLM-guided mode)
// ============================================================================

import type { UnifiedSkillDefinition } from "./adapters/types.js";
import { resourceLoader } from "./resources/resource-loader.js";
import { scriptExecutor } from "./resources/script-executor.js";

/**
 * Execute an Anthropic Skill with streaming output
 *
 * Anthropic Skills 使用 LLM-guided 执行模式:
 * 1. 加载技能指令 (Level 2)
 * 2. 将指令和用户请求发送给 LLM
 * 3. LLM 根据指令生成响应或调用脚本
 */
export async function* executeAnthropicSkillWithStream(
  userId: string,
  projectKey: string,
  skill: UnifiedSkillDefinition,
  userRequest: string,
  context?: string,
  traceContext?: TraceContext,
): AsyncGenerator<SkillStreamChunk> {
  yield { type: "thinking", content: `正在执行技能: ${skill.name}...` };

  try {
    // 1. 加载技能指令
    const instructions = await resourceLoader.loadInstructions(skill);
    const fullInstructions = instructions.join("\n\n---\n\n");

    // 2. 获取 LLM 配置
    const modelConfig = await configStore.getInternalByType("llm");
    if (!modelConfig) {
      yield { type: "error", error: "No LLM model configured" };
      return;
    }

    // 3. 构建 prompt
    const systemPrompt = buildAnthropicSkillSystemPrompt(skill, fullInstructions);
    const userPrompt = buildAnthropicSkillUserPrompt(userRequest, context);

    // 4. 调用 LLM
    yield { type: "thinking", content: "正在生成响应..." };

    const stream = await llmGateway.chatStream({
      model: modelConfig.defaultModel || "gpt-4",
      provider: modelConfig.providerId,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      traceContext,
    });

    let fullContent = "";

    // 使用 textStream 进行迭代
    for await (const chunk of stream.textStream) {
      fullContent += chunk;
      yield { type: "delta", content: chunk };
    }

    // 5. 检查是否需要执行脚本
    const scriptCommands = extractScriptCommands(fullContent, skill);
    if (scriptCommands.length > 0) {
      const shellEnabled = process.env.AGENT_ALLOW_SHELL === "true";
      if (!shellEnabled) {
        yield {
          type: "delta",
          content:
            "\n\n> 检测到技能请求执行脚本，但系统策略默认禁用 shell 执行（AGENT_ALLOW_SHELL != true）。已跳过命令执行。",
        };
      } else {
        yield { type: "thinking", content: "正在执行脚本..." };
        for (const cmd of scriptCommands) {
          const result = await scriptExecutor.executeCommand(skill, cmd);
          if (result.success) {
            yield { type: "delta", content: `\n\n**脚本输出:**\n\`\`\`\n${result.stdout}\n\`\`\`` };
          } else {
            yield { type: "delta", content: `\n\n**脚本错误:**\n\`\`\`\n${result.stderr}\n\`\`\`` };
          }
        }
      }
    }

    yield { type: "done", message: `技能 ${skill.name} 执行完成` };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    yield { type: "error", error: `技能执行失败: ${errorMessage}` };
  }
}

/**
 * Build system prompt for Anthropic Skill execution
 */
function buildAnthropicSkillSystemPrompt(
  skill: UnifiedSkillDefinition,
  instructions: string,
): string {
  return `你是一个专门执行 "${skill.name}" 技能的 AI 助手。

## 技能描述
${skill.description}

## 技能指令
${instructions}

## 执行规则
1. 严格按照技能指令执行任务
2. 如果需要执行脚本，使用以下格式:
   \`\`\`execute
   <command>
   \`\`\`
3. 确保输出清晰、结构化
4. 如果无法完成任务，说明原因

## 可用资源
${skill.resources?.map((r) => `- ${r.path} (${r.type})`).join("\n") || "无额外资源"}
`;
}

/**
 * Build user prompt for Anthropic Skill execution
 */
function buildAnthropicSkillUserPrompt(request: string, context?: string): string {
  let prompt = `## 用户请求\n${request}`;

  if (context) {
    prompt += `\n\n## 上下文\n${context}`;
  }

  return prompt;
}

/**
 * Extract script commands from LLM response
 */
function extractScriptCommands(content: string, skill: UnifiedSkillDefinition): string[] {
  const commands: string[] = [];

  // 匹配 ```execute\n<command>\n``` 格式
  const executeRegex = /```execute\n([\s\S]*?)```/g;
  let match;

  while ((match = executeRegex.exec(content)) !== null) {
    const command = match[1].trim();
    if (command && isAllowedCommand(command, skill)) {
      commands.push(command);
    }
  }

  return commands;
}

/**
 * Check if a command is allowed for the skill
 */
function isAllowedCommand(command: string, skill: UnifiedSkillDefinition): boolean {
  // 只允许执行技能目录中的脚本
  const scriptResources = skill.resources?.filter((r) => r.type === "script") || [];
  
  for (const script of scriptResources) {
    if (command.includes(script.path) || command.includes(script.name)) {
      return true;
    }
  }

  // 允许简单的 shell 命令 (echo, cat, ls 等)
  const allowedCommands = ["echo", "cat", "ls", "pwd", "head", "tail", "grep"];
  const firstWord = command.split(/\s+/)[0];
  
  return allowedCommands.includes(firstWord);
}
