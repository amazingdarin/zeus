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

// Maximum retries for LLM content generation
const MAX_RETRIES = 2;

/**
 * Detect skill intent from user message
 */
export function detectSkillIntent(
  message: string,
  docIds?: string[],
): SkillIntent | null {
  const trimmed = message.trim();

  // Check for explicit slash commands
  if (trimmed.startsWith("/doc-create")) {
    const rest = trimmed.slice("/doc-create".length).trim();
    // If user specified documents with @, use the first one as parent
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

  // Check for natural language patterns with @ document reference
  if (docIds && docIds.length > 0) {
    const editPatterns = [
      /修改|编辑|更新|调整|补充|添加|删除|移除|改进|优化|重写/,
    ];

    for (const pattern of editPatterns) {
      if (pattern.test(trimmed)) {
        return {
          skill: "doc-edit",
          command: "",
          args: { instructions: trimmed },
          rawMessage: message,
          docIds,
        };
      }
    }
  }

  // Check for creation patterns (@ reference optional, used as parent if provided)
  const createPatterns = [
    /^(创建|新建|写|生成|帮我写|写一个|创建一个).*(文档|文章|说明|指南|教程)/,
    /^(请|帮我)?(创建|新建|写|生成).*/,
  ];

  for (const pattern of createPatterns) {
    if (pattern.test(trimmed)) {
      // If user specified documents with @, use the first one as parent
      const parentId = docIds && docIds.length > 0 ? docIds[0] : null;
      return {
        skill: "doc-create",
        command: "",
        args: { title: extractTitle(trimmed), description: trimmed, parent_id: parentId },
        rawMessage: message,
        docIds,
      };
    }
  }

  return null;
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
): AsyncGenerator<SkillStreamChunk> {
  switch (intent.skill) {
    case "doc-read":
      yield* executeDocRead(projectKey, intent);
      break;
    case "doc-create":
      yield* executeDocCreate(projectKey, intent);
      break;
    case "doc-edit":
      yield* executeDocEdit(projectKey, intent);
      break;
    default:
      yield { type: "error", error: `Unknown skill: ${intent.skill}` };
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
): AsyncGenerator<SkillStreamChunk> {
  const title = String(intent.args.title || "新文档");
  const description = String(intent.args.description || "");
  const parentId = intent.args.parent_id as string | undefined;

  yield { type: "thinking", content: "正在生成文档内容..." };

  try {
    // Get LLM config
    const llmConfig = await configStore.getInternalByType("llm");
    if (!llmConfig) {
      yield { type: "error", error: "LLM 未配置，请先在设置中配置对话模型" };
      return;
    }

    // Build prompt
    const systemPrompt = buildCreateDocumentPrompt();
    const userPrompt = `请创建一个标题为「${title}」的文档。

${description ? `文档内容要求：${description}` : "请根据标题生成合适的文档内容。"}

请直接输出 Tiptap JSON 格式的文档正文（body 部分），不要添加任何说明文字。`;

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
      projectKey,
      docId: null,
      parentId: parentId || null,
      title,
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
 * Execute doc-edit skill
 */
async function* executeDocEdit(
  projectKey: string,
  intent: SkillIntent,
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
 * Get available skill commands
 */
export function getAvailableSkillCommands(): Array<{
  command: string;
  name: string;
  description: string;
}> {
  return [
    {
      command: "/doc-create",
      name: "创建文档",
      description: "创建新文档。使用方法：/doc-create [文档标题]",
    },
    {
      command: "/doc-edit",
      name: "编辑文档",
      description: "编辑已有文档。需要先用 @ 指定文档，然后描述修改要求",
    },
    {
      command: "/doc-read",
      name: "读取文档",
      description: "读取文档内容。使用方法：/doc-read @文档名",
    },
  ];
}
