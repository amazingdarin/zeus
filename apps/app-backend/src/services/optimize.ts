/**
 * Document Optimization Service
 *
 * Uses LLM to optimize document format and content.
 */

import { v4 as uuidv4 } from "uuid";
import type { JSONContent } from "@tiptap/core";
import { configStore, llmGateway, type ProviderConfigInternal } from "../llm/index.js";
import { documentStore } from "../storage/document-store.js";
import { tiptapJsonToMarkdown, markdownToTiptapJson } from "@zeus/shared";

// ============================================================================
// Types
// ============================================================================

export type OptimizeMode = "format" | "content" | "full";

export type OptimizeOptions = {
  mode: OptimizeMode;
  preserveStructure?: boolean;
  language?: string;
};

export type OptimizeTask = {
  id: string;
  projectKey: string;
  docId: string;
  options: OptimizeOptions;
  status: "pending" | "running" | "completed" | "failed";
  originalMarkdown: string;
  optimizedMarkdown: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
};

export type OptimizeStreamChunk = {
  type: "delta" | "done" | "error";
  content?: string;
  originalMarkdown?: string;
  optimizedMarkdown?: string;
  optimizedContent?: JSONContent;
  error?: string;
};

// ============================================================================
// In-memory task storage
// ============================================================================

const activeTasks = new Map<string, OptimizeTask>();
const TASK_TTL = 30 * 60 * 1000; // 30 minutes

function cleanupOldTasks() {
  const now = Date.now();
  for (const [taskId, task] of activeTasks) {
    if (now - task.updatedAt > TASK_TTL) {
      activeTasks.delete(taskId);
    }
  }
}

// Run cleanup every 5 minutes
setInterval(cleanupOldTasks, 5 * 60 * 1000);

// ============================================================================
// LLM Config Cache
// ============================================================================

let llmConfigCache: { config: ProviderConfigInternal | null; timestamp: number } | null = null;
const CONFIG_CACHE_TTL = 60 * 1000; // 1 minute

async function getLLMConfig(): Promise<ProviderConfigInternal | null> {
  if (llmConfigCache && Date.now() - llmConfigCache.timestamp < CONFIG_CACHE_TTL) {
    return llmConfigCache.config;
  }
  const config = await configStore.getInternalByType("llm");
  llmConfigCache = { config, timestamp: Date.now() };
  return config;
}

export function clearLLMConfigCache(): void {
  llmConfigCache = null;
}

// ============================================================================
// Prompt Templates
// ============================================================================

const FORMAT_PROMPT = `你是一个专业的文档格式优化专家。请对以下 Markdown 文档进行格式优化：

## 优化要求
1. **标题层级**：确保标题层级合理，H1 仅用于文档标题，正文从 H2 开始
2. **列表规范**：统一列表格式，有序列表用于步骤，无序列表用于枚举
3. **代码块**：确保代码块有正确的语言标记
4. **段落结构**：合理分段，每段聚焦一个主题
5. **空白处理**：去除多余空行，保持格式整洁

## 重要规则
- 保持原文内容含义不变
- 只调整格式，不修改实际内容
- 输出纯 Markdown 格式，不要添加任何解释

## 原文档
\`\`\`markdown
{{CONTENT}}
\`\`\`

请直接输出优化后的 Markdown 文档：`;

const CONTENT_PROMPT = `你是一个专业的文档内容编辑专家。请对以下 Markdown 文档进行内容优化：

## 优化要求
1. **语言润色**：改善语言表达，使其更加专业、流畅
2. **逻辑梳理**：增强内容的逻辑连贯性
3. **冗余精简**：删除重复或冗余的内容
4. **过渡完善**：适当添加过渡语句，使文档更易读

## 重要规则
- 保持原文的核心信息和观点
- 保持原有的文档结构和章节安排
- 保持技术术语和专有名词不变
- 输出纯 Markdown 格式，不要添加任何解释

## 原文档
\`\`\`markdown
{{CONTENT}}
\`\`\`

请直接输出优化后的 Markdown 文档：`;

const FULL_PROMPT = `你是一个专业的文档编辑专家。请对以下 Markdown 文档进行全面优化（格式 + 内容）：

## 格式优化要求
1. 确保标题层级合理（H1 仅用于标题，正文从 H2 开始）
2. 统一列表格式
3. 确保代码块有正确的语言标记
4. 合理分段，去除多余空行

## 内容优化要求
1. 改善语言表达，使其更加专业、流畅
2. 增强内容的逻辑连贯性
3. 删除重复或冗余的内容
4. 适当添加过渡语句

## 重要规则
- 保持原文的核心信息和观点
- 保持技术术语和专有名词不变
- 输出纯 Markdown 格式，不要添加任何解释

## 原文档
\`\`\`markdown
{{CONTENT}}
\`\`\`

请直接输出优化后的 Markdown 文档：`;

function getPromptTemplate(mode: OptimizeMode): string {
  switch (mode) {
    case "format":
      return FORMAT_PROMPT;
    case "content":
      return CONTENT_PROMPT;
    case "full":
    default:
      return FULL_PROMPT;
  }
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Create a new optimization task
 */
export async function createTask(
  projectKey: string,
  docId: string,
  options: OptimizeOptions,
): Promise<string> {
  // Get document
  const doc = await documentStore.get(projectKey, docId);

  // Convert to markdown
  const originalMarkdown = tiptapJsonToMarkdown(doc.body.content as JSONContent);

  const taskId = uuidv4();
  const task: OptimizeTask = {
    id: taskId,
    projectKey,
    docId,
    options,
    status: "pending",
    originalMarkdown,
    optimizedMarkdown: "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  activeTasks.set(taskId, task);
  return taskId;
}

/**
 * Get a task by ID
 */
export function getTask(taskId: string): OptimizeTask | null {
  return activeTasks.get(taskId) || null;
}

/**
 * Stream optimization results
 */
export async function* streamTask(taskId: string): AsyncGenerator<OptimizeStreamChunk> {
  const task = activeTasks.get(taskId);
  if (!task) {
    yield { type: "error", error: "Task not found" };
    return;
  }

  // Get LLM config
  const config = await getLLMConfig();
  if (!config || !config.enabled) {
    yield {
      type: "error",
      error: "No LLM provider configured. Please configure an LLM provider in settings.",
    };
    task.status = "failed";
    task.error = "No LLM provider configured";
    task.updatedAt = Date.now();
    return;
  }

  if (!config.defaultModel) {
    yield { type: "error", error: "No default model configured for LLM provider." };
    task.status = "failed";
    task.error = "No default model configured";
    task.updatedAt = Date.now();
    return;
  }

  task.status = "running";
  task.updatedAt = Date.now();

  try {
    // Build prompt
    const promptTemplate = getPromptTemplate(task.options.mode);
    const prompt = promptTemplate.replace("{{CONTENT}}", task.originalMarkdown);

    console.log(`[optimize] Starting optimization for doc ${task.docId}, mode: ${task.options.mode}`);

    // Call LLM gateway with streaming
    const stream = await llmGateway.chatStream({
      provider: config.providerId,
      model: config.defaultModel,
      messages: [{ role: "user", content: prompt }],
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
    });

    let optimizedMarkdown = "";

    // Stream the response
    for await (const chunk of stream.textStream) {
      optimizedMarkdown += chunk;
      task.optimizedMarkdown = optimizedMarkdown;
      task.updatedAt = Date.now();
      yield { type: "delta", content: chunk };
    }

    // Clean up markdown output (remove potential code block wrappers)
    optimizedMarkdown = cleanMarkdownOutput(optimizedMarkdown);
    task.optimizedMarkdown = optimizedMarkdown;

    // Convert back to Tiptap JSON
    const optimizedContent = markdownToTiptapJson(optimizedMarkdown);

    task.status = "completed";
    task.updatedAt = Date.now();

    console.log(`[optimize] Completed optimization for doc ${task.docId}`);

    yield {
      type: "done",
      originalMarkdown: task.originalMarkdown,
      optimizedMarkdown,
      optimizedContent,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Optimization failed";
    console.error("[optimize] Stream error:", errorMessage);

    task.status = "failed";
    task.error = errorMessage;
    task.updatedAt = Date.now();

    yield { type: "error", error: errorMessage };
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

/**
 * Delete a task
 */
export function deleteTask(taskId: string): boolean {
  return activeTasks.delete(taskId);
}
