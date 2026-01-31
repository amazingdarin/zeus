/**
 * OCR Service
 *
 * Uses LLM vision models to extract and convert document content
 * from images/PDFs to Tiptap JSON format.
 */

import type { JSONContent } from "@tiptap/core";
import { generateText } from "ai";
import { configStore, type ProviderConfigInternal } from "../llm/index.js";
import { providerRegistry } from "../llm/providers.js";

// ============================================================================
// Types
// ============================================================================

export type OCROutputFormat = "tiptap" | "markdown";

export type OCRRequest = {
  image: string; // base64 data URL or HTTP URL
  outputFormat?: OCROutputFormat;
  language?: string; // zh, en, etc.
};

export type OCRResponse = {
  content: JSONContent;
  markdown?: string;
  rawResponse?: string;
};

// ============================================================================
// Prompt Templates
// ============================================================================

const TIPTAP_SCHEMA_EXAMPLE = `{
  "type": "doc",
  "content": [
    { "type": "heading", "attrs": { "level": 1 }, "content": [{ "type": "text", "text": "标题" }] },
    { "type": "paragraph", "content": [{ "type": "text", "text": "段落内容" }] },
    { "type": "bulletList", "content": [
      { "type": "listItem", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "列表项" }] }] }
    ]},
    { "type": "orderedList", "attrs": { "start": 1 }, "content": [
      { "type": "listItem", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "有序列表项" }] }] }
    ]},
    { "type": "codeBlock", "attrs": { "language": "python" }, "content": [{ "type": "text", "text": "print('hello')" }] },
    { "type": "blockquote", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "引用内容" }] }] }
  ]
}`;

const buildOCRPrompt = (language?: string): string => {
  const langHint = language === "en" ? "The document is in English." : "文档可能是中文或英文。";

  return `你是一个专业的文档 OCR 助手。请将图片中的文档内容转换为 Tiptap JSON 格式。

## 输出格式要求
输出必须是有效的 JSON，结构示例如下：
${TIPTAP_SCHEMA_EXAMPLE}

## 支持的节点类型
- heading: 标题，attrs.level 为 1-6
- paragraph: 段落
- bulletList: 无序列表
- orderedList: 有序列表
- listItem: 列表项
- codeBlock: 代码块，attrs.language 为代码语言
- blockquote: 引用块
- horizontalRule: 分隔线
- image: 图片（如果文档中包含图片描述，可以用 paragraph 替代）

## 文本格式（marks）
在 text 节点中可以使用 marks 数组：
- { "type": "bold" } 粗体
- { "type": "italic" } 斜体
- { "type": "code" } 行内代码
- { "type": "link", "attrs": { "href": "url" } } 链接

## 规则
1. 识别并保持标题层级 (h1-h6)
2. 正确识别列表类型（有序/无序）
3. 识别代码块并尽量标注语言
4. 保持原文档的结构和格式
5. ${langHint}
6. 只输出 JSON，不要添加任何解释、代码块标记或其他文字
7. 确保 JSON 格式有效，可以直接解析

请分析图片中的文档内容并输出 Tiptap JSON：`;
};

const buildMarkdownPrompt = (language?: string): string => {
  const langHint = language === "en" ? "The document is in English." : "文档可能是中文或英文。";

  return `你是一个专业的文档 OCR 助手。请将图片中的文档内容转换为 Markdown 格式。

## 规则
1. 使用正确的标题层级 (#, ##, ###, 等)
2. 正确使用列表格式（- 或 1. 2. 3.）
3. 代码块使用 \`\`\`language 标记
4. 保持原文档的结构和格式
5. ${langHint}
6. 只输出 Markdown 内容，不要添加任何解释

请分析图片中的文档内容并输出 Markdown：`;
};

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

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Parse OCR response to extract JSON content
 */
function parseOCRResponse(response: string): JSONContent {
  // Try to extract JSON from the response
  let jsonStr = response.trim();

  // Remove markdown code block if present
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  // Try to find JSON object boundaries
  const startIdx = jsonStr.indexOf("{");
  const endIdx = jsonStr.lastIndexOf("}");
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    jsonStr = jsonStr.slice(startIdx, endIdx + 1);
  }

  try {
    const parsed = JSON.parse(jsonStr);
    // Validate basic structure
    if (parsed.type === "doc" && Array.isArray(parsed.content)) {
      return parsed as JSONContent;
    }
    // If it's just content array, wrap it
    if (Array.isArray(parsed)) {
      return { type: "doc", content: parsed };
    }
    // Return as-is if it looks valid
    return parsed as JSONContent;
  } catch (err) {
    console.error("[OCR] Failed to parse JSON response:", err);
    console.error("[OCR] Raw response:", response);
    // Return a fallback with the raw text
    return {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: response }],
        },
      ],
    };
  }
}

/**
 * Perform OCR on an image using vision LLM
 */
export async function parseImage(request: OCRRequest): Promise<OCRResponse> {
  const config = await getLLMConfig();
  if (!config || !config.enabled) {
    throw new Error("No LLM provider configured. Please configure an LLM provider in settings.");
  }

  if (!config.defaultModel) {
    throw new Error("No default model configured for LLM provider.");
  }

  const outputFormat = request.outputFormat || "tiptap";
  const prompt =
    outputFormat === "markdown"
      ? buildMarkdownPrompt(request.language)
      : buildOCRPrompt(request.language);

  console.log(`[OCR] Processing image with ${config.providerId}/${config.defaultModel}`);

  // Get the model
  const model = providerRegistry.getLanguageModel(config.providerId, config.defaultModel, {
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
  });

  // Build message content with image
  // The Vercel AI SDK supports multimodal content
  const imageContent = request.image.startsWith("data:")
    ? { type: "image" as const, image: request.image }
    : { type: "image" as const, image: new URL(request.image) };

  try {
    const result = await generateText({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            imageContent,
          ],
        },
      ],
      temperature: 0.1, // Low temperature for more deterministic output
      maxTokens: 4096,
    });

    const rawResponse = result.text;
    console.log(`[OCR] Received response, length: ${rawResponse.length}`);

    if (outputFormat === "markdown") {
      // For markdown output, we need to convert to Tiptap JSON
      const { markdownToTiptapJson } = await import("../utils/markdown.js");
      const content = markdownToTiptapJson(rawResponse);
      return {
        content,
        markdown: rawResponse,
        rawResponse,
      };
    }

    // Parse Tiptap JSON directly
    const content = parseOCRResponse(rawResponse);
    return {
      content,
      rawResponse,
    };
  } catch (err) {
    console.error("[OCR] Vision API error:", err);
    throw new Error(`OCR failed: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

/**
 * Check if the configured LLM supports vision
 */
export async function isVisionAvailable(): Promise<boolean> {
  const config = await getLLMConfig();
  if (!config || !config.enabled || !config.defaultModel) {
    return false;
  }

  // Vision-capable models (common ones)
  const visionModels = [
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4-vision",
    "gpt-4-vision-preview",
    "gpt-4-turbo",
    "claude-3-opus",
    "claude-3-sonnet",
    "claude-3-haiku",
    "claude-3-5-sonnet",
    "gemini-pro-vision",
    "gemini-1.5-pro",
    "gemini-1.5-flash",
    "qwen-vl-plus",
    "qwen-vl-max",
    "qwen2-vl",
    "llava",
    "llava-llama3",
    "bakllava",
    "moondream",
  ];

  const modelLower = config.defaultModel.toLowerCase();
  return visionModels.some((vm) => modelLower.includes(vm.toLowerCase()));
}

export const ocrService = {
  parseImage,
  isVisionAvailable,
};
