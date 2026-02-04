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
import { draftService } from "../../services/draft.js";
import {
  buildCreateDocumentPrompt,
  buildEditDocumentPrompt,
} from "./spec-loader.js";
import type {
  SkillIntent,
  SkillStreamChunk,
  DocumentDraft,
} from "./types.js";
import { validateTiptapContent, fixCommonIssues } from "./validator.js";
import { tiptapJsonToMarkdown, markdownToTiptapJson } from "../../utils/markdown.js";
import { skillConfigStore } from "./skill-config-store.js";
import { FORMAT_PROMPT, CONTENT_PROMPT } from "../../services/optimize.js";
import { ensureBlockIds } from "../../utils/block-id.js";
import { traceManager, type TraceContext } from "../../observability/index.js";

// Maximum retries for LLM content generation
const MAX_RETRIES = 2;

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
    const parentId = docIds && docIds.length > 0 ? docIds[0] : null;
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

  if (trimmed.startsWith("/doc-optimize-format")) {
    return {
      skill: "doc-optimize-format",
      command: "/doc-optimize-format",
      args: {},
      rawMessage: message,
      docIds,
    };
  }

  if (trimmed.startsWith("/doc-optimize-content")) {
    return {
      skill: "doc-optimize-content",
      command: "/doc-optimize-content",
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
        yield* executeDocRead(projectKey, intent);
        break;
      case "doc-create":
        yield* executeDocCreate(projectKey, intent, traceContext);
        break;
      case "doc-edit":
        yield* executeDocEdit(projectKey, intent, traceContext);
        break;
      case "doc-optimize-format":
        yield* executeDocOptimizeFormat(projectKey, intent, traceContext);
        break;
      case "doc-optimize-content":
        yield* executeDocOptimizeContent(projectKey, intent, traceContext);
        break;
      case "doc-summary":
        yield* executeDocSummary(projectKey, intent, traceContext);
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
 * Execute doc-read skill
 */
async function* executeDocRead(
  projectKey: string,
  intent: SkillIntent,
): AsyncGenerator<SkillStreamChunk> {
  if (!intent.docIds || intent.docIds.length === 0) {
    yield { type: "error", error: "请使用 @ 指定要读取的文档" };
    return;
  }

  try {
    const docId = intent.docIds[0];
    const doc = await documentStore.get(projectKey, docId);
    
    // Convert to markdown for display
    const markdown = tiptapJsonToMarkdown(doc.body as JSONContent);
    
    yield {
      type: "delta",
      content: `## ${doc.meta.title}\n\n${markdown}`,
    };
    yield { type: "done", message: "文档内容已读取" };
  } catch (err) {
    yield {
      type: "error",
      error: `读取文档失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Execute doc-create skill
 */
async function* executeDocCreate(
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
    const doc = await documentStore.get(projectKey, docId);
    const originalContent = doc.body as JSONContent;
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

    // Debug logging
    console.log("[doc-edit] originalContent type:", originalContent?.type);
    console.log("[doc-edit] originalContent has content:", Array.isArray(originalContent?.content));
    console.log("[doc-edit] proposedContent type:", proposedContent?.type);
    console.log("[doc-edit] proposedContent has content:", Array.isArray((proposedContent as Record<string, unknown>)?.content));

    // Create draft
    const draft = draftService.create({
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
 * Execute doc-optimize-format skill
 */
async function* executeDocOptimizeFormat(
  projectKey: string,
  intent: SkillIntent,
  traceContext?: TraceContext,
): AsyncGenerator<SkillStreamChunk> {
  if (!intent.docIds || intent.docIds.length === 0) {
    yield { type: "error", error: "请使用 @ 指定要优化的文档" };
    return;
  }

  const docId = intent.docIds[0];

  yield { type: "thinking", content: "正在读取文档内容..." };

  try {
    // Get original document
    const doc = await documentStore.get(projectKey, docId);
    const originalContent = doc.body as JSONContent;
    const originalMarkdown = tiptapJsonToMarkdown(originalContent);

    yield { type: "thinking", content: "正在优化文档格式..." };

    // Get LLM config
    const llmConfig = await configStore.getInternalByType("llm");
    if (!llmConfig) {
      yield { type: "error", error: "LLM 未配置，请先在设置中配置对话模型" };
      return;
    }

    // Build prompt from template
    const prompt = FORMAT_PROMPT.replace("{{CONTENT}}", originalMarkdown);

    // Generate content with streaming
    let fullContent = "";
    const stream = await llmGateway.chatStream({
      provider: llmConfig.providerId,
      model: llmConfig.defaultModel || "gpt-4o",
      apiKey: llmConfig.apiKey,
      baseUrl: llmConfig.baseUrl,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3, // Lower temperature for more consistent formatting
      traceContext,
    });

    for await (const chunk of stream.textStream) {
      fullContent += chunk;
      yield { type: "delta", content: chunk };
    }

    // Clean up markdown output (remove potential code block wrappers)
    const cleanedMarkdown = cleanMarkdownOutput(fullContent);

    // Convert to Tiptap JSON
    const rawJson = markdownToTiptapJson(cleanedMarkdown);
    const proposedContent = ensureBlockIds(rawJson) as JSONContent;
    
    // Debug logging
    console.log("[doc-optimize-format] originalContent type:", originalContent?.type);
    console.log("[doc-optimize-format] originalContent has content:", Array.isArray(originalContent?.content));
    console.log("[doc-optimize-format] proposedContent type:", proposedContent?.type);
    console.log("[doc-optimize-format] proposedContent has content:", Array.isArray((proposedContent as Record<string, unknown>)?.content));

    // Create draft
    const draft = draftService.create({
      projectKey,
      docId,
      parentId: doc.meta.parent_id || null,
      title: doc.meta.title,
      originalContent,
      proposedContent,
    });

    yield { type: "draft", draft };
    yield { type: "done", message: "文档格式优化草稿已生成" };
  } catch (err) {
    yield {
      type: "error",
      error: `格式优化失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Execute doc-optimize-content skill
 */
async function* executeDocOptimizeContent(
  projectKey: string,
  intent: SkillIntent,
  traceContext?: TraceContext,
): AsyncGenerator<SkillStreamChunk> {
  if (!intent.docIds || intent.docIds.length === 0) {
    yield { type: "error", error: "请使用 @ 指定要优化的文档" };
    return;
  }

  const docId = intent.docIds[0];

  yield { type: "thinking", content: "正在读取文档内容..." };

  try {
    // Get original document
    const doc = await documentStore.get(projectKey, docId);
    const originalContent = doc.body as JSONContent;
    const originalMarkdown = tiptapJsonToMarkdown(originalContent);

    yield { type: "thinking", content: "正在优化文档内容..." };

    // Get LLM config
    const llmConfig = await configStore.getInternalByType("llm");
    if (!llmConfig) {
      yield { type: "error", error: "LLM 未配置，请先在设置中配置对话模型" };
      return;
    }

    // Build prompt from template
    const prompt = CONTENT_PROMPT.replace("{{CONTENT}}", originalMarkdown);

    // Generate content with streaming
    let fullContent = "";
    const stream = await llmGateway.chatStream({
      provider: llmConfig.providerId,
      model: llmConfig.defaultModel || "gpt-4o",
      apiKey: llmConfig.apiKey,
      baseUrl: llmConfig.baseUrl,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.5, // Slightly higher for content optimization
      traceContext,
    });

    for await (const chunk of stream.textStream) {
      fullContent += chunk;
      yield { type: "delta", content: chunk };
    }

    // Clean up markdown output (remove potential code block wrappers)
    const cleanedMarkdown = cleanMarkdownOutput(fullContent);

    // Convert to Tiptap JSON
    const proposedContent = ensureBlockIds(markdownToTiptapJson(cleanedMarkdown)) as JSONContent;

    // Create draft
    const draft = draftService.create({
      projectKey,
      docId,
      parentId: doc.meta.parent_id || null,
      title: doc.meta.title,
      originalContent,
      proposedContent,
    });

    yield { type: "draft", draft };
    yield { type: "done", message: "文档内容优化草稿已生成" };
  } catch (err) {
    yield {
      type: "error",
      error: `内容优化失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Clean up markdown output from LLM
 * Removes potential code block wrappers that LLM might add
 */
function cleanMarkdownOutput(markdown: string): string {
  let result = markdown.trim();

  // Remove leading ```markdown or ``` and trailing ```
  const codeBlockMatch = result.match(/^```(?:markdown)?\s*\n([\s\S]*?)\n```$/);
  if (codeBlockMatch) {
    result = codeBlockMatch[1].trim();
  }

  return result;
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
    const doc = await documentStore.get(projectKey, docId);
    
    // Extract the actual document content (handle nested structure)
    const originalContent = extractDocContent(doc.body as JSONContent);

    // 3. Check if already has a summary block at top
    const existingSummary = checkExistingSummary(originalContent);
    if (existingSummary) {
      yield { type: "thinking", content: `检测到已有摘要，将进行替换...` };
    }

    // 4. Check if has children (determine if directory or single document)
    const children = await documentStore.getChildren(projectKey, docId);
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
function extractDocContent(body: JSONContent): JSONContent {
  console.log("[extractDocContent] body.type:", body?.type);
  
  // If already a doc type, return as is
  if (body.type === "doc" && Array.isArray(body.content)) {
    console.log("[extractDocContent] Already doc type, content length:", body.content.length);
    return body;
  }
  
  // Handle tiptap wrapper: { type: "tiptap", content: { type: "doc", content: [...] } }
  if (body.type === "tiptap" && body.content) {
    const inner = body.content as JSONContent;
    console.log("[extractDocContent] Tiptap wrapper, inner.type:", inner?.type);
    
    if (inner.type === "doc" && Array.isArray(inner.content)) {
      console.log("[extractDocContent] Extracted doc from tiptap, content length:", inner.content.length);
      return inner;
    }
    // If content is an array (directly blocks), wrap it
    if (Array.isArray(inner)) {
      console.log("[extractDocContent] Content is array, wrapping as doc, length:", inner.length);
      return { type: "doc", content: inner };
    }
    // If content is a single block object, wrap it in array
    if (inner && typeof inner === "object" && inner.type) {
      console.log("[extractDocContent] Content is single block, wrapping:", inner.type);
      return { type: "doc", content: [inner] };
    }
  }
  
  // Fallback: if body has content array, wrap it as doc
  if (Array.isArray(body.content)) {
    console.log("[extractDocContent] Fallback: body.content is array, length:", body.content.length);
    return { type: "doc", content: body.content as JSONContent[] };
  }
  
  // Last resort: return empty doc
  console.warn("[extractDocContent] Unable to extract content from body:", JSON.stringify(body).slice(0, 200));
  return { type: "doc", content: [] };
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
  projectKey: string,
  parentId: string,
  maxDepth: number,
  currentDepth = 0,
): Promise<string[]> {
  if (currentDepth >= maxDepth) {
    return [];
  }
  
  const children = await documentStore.getChildren(projectKey, parentId);
  const ids: string[] = [];
  
  for (const child of children) {
    ids.push(child.id);
    // Recursively collect descendants with depth tracking
    const descendants = await collectDescendantsWithLimit(
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
  projectKey: string,
  dirId: string,
  dirDoc: { meta: { title: string }; body: JSONContent },
  _intent: SkillIntent,
  _progressCallback?: (msg: string) => AsyncGenerator<SkillStreamChunk>,
): Promise<JSONContent> {
  // Recursively collect descendant IDs with depth limit
  const allDescendantIds = await collectDescendantsWithLimit(
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
      const childDoc = await documentStore.get(projectKey, id);
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
