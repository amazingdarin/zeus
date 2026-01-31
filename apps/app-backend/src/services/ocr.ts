/**
 * OCR Service
 *
 * Unified OCR interface supporting multiple backends:
 * 1. LLM Vision Models (OpenAI, Anthropic, etc.)
 * 2. PaddleOCR-VL (local Python service)
 */

import type { JSONContent } from "@tiptap/core";
import { generateText } from "ai";
import { configStore, type ProviderConfigInternal } from "../llm/index.js";
import { providerRegistry } from "../llm/providers.js";

// ============================================================================
// Types
// ============================================================================

export type OCROutputFormat = "tiptap" | "markdown";
export type OCRProvider = "llm" | "paddle";

export type OCRRequest = {
  image: string; // base64 data URL or HTTP URL
  outputFormat?: OCROutputFormat;
  language?: string; // zh, en, etc.
  provider?: OCRProvider; // OCR provider to use
};

export type OCRResponse = {
  content: JSONContent;
  markdown?: string;
  rawResponse?: string;
  provider?: string; // Which provider was used
};

export type OCRProviderStatus = {
  llm: {
    available: boolean;
    model?: string;
  };
  paddle: {
    available: boolean;
    endpoint?: string;
  };
};

// ============================================================================
// Configuration
// ============================================================================

/**
 * Get PaddleOCR endpoint from vision config
 * PaddleOCR is now configured via settings (vision config), not env vars
 */
async function getPaddleOCREndpoint(): Promise<string | null> {
  const visionConfig = await getVisionConfig();
  
  // Only use PaddleOCR if configured in settings
  if (visionConfig && visionConfig.enabled && visionConfig.providerId === "paddleocr") {
    return visionConfig.baseUrl || null;
  }
  
  return null;
}

// ============================================================================
// Prompt Templates (for LLM Vision)
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
// Config Cache
// ============================================================================

let visionConfigCache: { config: ProviderConfigInternal | null; timestamp: number } | null = null;
let llmConfigCache: { config: ProviderConfigInternal | null; timestamp: number } | null = null;
const CONFIG_CACHE_TTL = 60 * 1000; // 1 minute

async function getVisionConfig(): Promise<ProviderConfigInternal | null> {
  if (visionConfigCache && Date.now() - visionConfigCache.timestamp < CONFIG_CACHE_TTL) {
    return visionConfigCache.config;
  }
  const config = await configStore.getInternalByType("vision");
  visionConfigCache = { config, timestamp: Date.now() };
  return config;
}

async function getLLMConfig(): Promise<ProviderConfigInternal | null> {
  if (llmConfigCache && Date.now() - llmConfigCache.timestamp < CONFIG_CACHE_TTL) {
    return llmConfigCache.config;
  }
  const config = await configStore.getInternalByType("llm");
  llmConfigCache = { config, timestamp: Date.now() };
  return config;
}

/**
 * Get the best available vision-capable config
 * Priority: vision config > llm config (if vision-capable)
 */
async function getVisionCapableConfig(): Promise<ProviderConfigInternal | null> {
  // First try dedicated vision config
  const visionConfig = await getVisionConfig();
  if (visionConfig && visionConfig.enabled && visionConfig.defaultModel) {
    return visionConfig;
  }
  
  // Fall back to LLM config if no vision config
  const llmConfig = await getLLMConfig();
  if (llmConfig && llmConfig.enabled && llmConfig.defaultModel) {
    return llmConfig;
  }
  
  return null;
}

// ============================================================================
// PaddleOCR Service Client
// ============================================================================

let paddleOCRCache: { available: boolean; endpoint: string; timestamp: number } | null = null;
const PADDLE_CHECK_TTL = 30 * 1000; // 30 seconds

/**
 * Check if PaddleOCR service is available and return its endpoint
 */
async function checkPaddleOCR(): Promise<{ available: boolean; endpoint: string | null }> {
  const endpoint = await getPaddleOCREndpoint();
  
  if (!endpoint) {
    return { available: false, endpoint: null };
  }
  
  const now = Date.now();
  if (paddleOCRCache && paddleOCRCache.endpoint === endpoint && now - paddleOCRCache.timestamp < PADDLE_CHECK_TTL) {
    return { available: paddleOCRCache.available, endpoint };
  }

  try {
    const response = await fetch(`${endpoint}/api/ocr/health`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      const data = await response.json();
      const available = data.paddleocr_available === true || data.status === "healthy" || data.status === "ok";
      paddleOCRCache = { available, endpoint, timestamp: now };
      return { available, endpoint };
    } else {
      paddleOCRCache = { available: false, endpoint, timestamp: now };
      return { available: false, endpoint };
    }
  } catch {
    paddleOCRCache = { available: false, endpoint, timestamp: now };
    return { available: false, endpoint };
  }
}

/**
 * Parse image using PaddleOCR service
 */
async function parseWithPaddleOCR(request: OCRRequest, endpoint: string): Promise<OCRResponse> {
  const outputFormat = request.outputFormat || "tiptap";

  console.log(`[OCR] Processing image with PaddleOCR at ${endpoint}`);

  try {
    const response = await fetch(`${endpoint}/api/ocr/parse-base64`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        image: request.image,
        output_format: outputFormat,
        language: request.language || "auto",
      }),
      signal: AbortSignal.timeout(120000), // 2 minute timeout for OCR
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`PaddleOCR request failed: ${response.status} ${errorText}`);
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || "PaddleOCR processing failed");
    }

    // Log OCR result details
    console.log(`[OCR] ========== PaddleOCR Result ==========`);
    console.log(`[OCR] Provider: PaddleOCR (${endpoint})`);
    console.log(`[OCR] Output format: ${outputFormat}`);
    console.log(`[OCR] Markdown length: ${result.markdown?.length || 0} chars`);
    if (result.markdown) {
      // Print first 500 chars of markdown for debugging
      const preview = result.markdown.length > 500 
        ? result.markdown.substring(0, 500) + "...(truncated)" 
        : result.markdown;
      console.log(`[OCR] Markdown preview:\n${preview}`);
    }
    if (result.content) {
      const contentStr = JSON.stringify(result.content);
      console.log(`[OCR] Tiptap JSON length: ${contentStr.length} chars`);
      // Print node types summary
      if (result.content.content && Array.isArray(result.content.content)) {
        const nodeTypes = result.content.content.map((n: { type?: string }) => n.type).filter(Boolean);
        console.log(`[OCR] Node types: ${nodeTypes.join(", ")}`);
      }
    }
    console.log(`[OCR] ========================================`);

    return {
      content: result.content,
      markdown: result.markdown,
      rawResponse: JSON.stringify(result),
      provider: `PaddleOCR (${endpoint})`,
    };
  } catch (err) {
    console.error("[OCR] PaddleOCR error:", err);
    throw new Error(`PaddleOCR failed: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

// ============================================================================
// LLM Vision OCR
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
 * Parse image using LLM vision
 * Uses dedicated vision config if available, otherwise falls back to LLM config
 */
async function parseWithLLMVision(request: OCRRequest): Promise<OCRResponse> {
  const config = await getVisionCapableConfig();
  if (!config || !config.enabled) {
    throw new Error("未配置视觉模型。请在设置中配置视觉模型或 LLM 提供商。");
  }

  if (!config.defaultModel) {
    throw new Error("未配置默认模型。");
  }

  const outputFormat = request.outputFormat || "tiptap";
  const prompt =
    outputFormat === "markdown"
      ? buildMarkdownPrompt(request.language)
      : buildOCRPrompt(request.language);

  console.log(`[OCR] Processing image with LLM Vision: ${config.providerId}/${config.defaultModel}`);

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
    console.log(`[OCR] LLM Vision response received, length: ${rawResponse.length}`);

    if (outputFormat === "markdown") {
      // For markdown output, we need to convert to Tiptap JSON
      const { markdownToTiptapJson } = await import("../utils/markdown.js");
      const content = markdownToTiptapJson(rawResponse);
      return {
        content,
        markdown: rawResponse,
        rawResponse,
        provider: `LLM Vision (${config.providerId}/${config.defaultModel})`,
      };
    }

    // Parse Tiptap JSON directly
    const content = parseOCRResponse(rawResponse);
    return {
      content,
      rawResponse,
      provider: `LLM Vision (${config.providerId}/${config.defaultModel})`,
    };
  } catch (err) {
    console.error("[OCR] LLM Vision API error:", err);
    throw new Error(`LLM Vision OCR failed: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Perform OCR on an image
 *
 * This function will automatically select the best available provider:
 * 1. If provider is specified, use that provider
 * 2. If PaddleOCR is available, prefer it for better accuracy
 * 3. Fall back to LLM vision if available
 */
export async function parseImage(request: OCRRequest): Promise<OCRResponse> {
  const preferredProvider = request.provider;

  // If specific provider is requested
  if (preferredProvider === "paddle") {
    const paddle = await checkPaddleOCR();
    if (!paddle.available || !paddle.endpoint) {
      throw new Error("PaddleOCR service is not available. Please configure it in settings or use LLM vision.");
    }
    return parseWithPaddleOCR(request, paddle.endpoint);
  }

  if (preferredProvider === "llm") {
    return parseWithLLMVision(request);
  }

  // Auto-select provider
  // First check if vision config is PaddleOCR
  const visionConfig = await getVisionConfig();
  if (visionConfig && visionConfig.enabled && visionConfig.providerId === "paddleocr") {
    const paddle = await checkPaddleOCR();
    if (paddle.available && paddle.endpoint) {
      console.log(`[OCR] Using PaddleOCR from config: ${paddle.endpoint}`);
      try {
        return await parseWithPaddleOCR(request, paddle.endpoint);
      } catch (err) {
        console.warn("[OCR] PaddleOCR failed, falling back to LLM Vision:", err instanceof Error ? err.message : err);
      }
    }
  }

  // Try LLM vision (from vision config or LLM config)
  const llmConfig = await getVisionCapableConfig();
  if (llmConfig && llmConfig.enabled && llmConfig.providerId !== "paddleocr") {
    console.log("[OCR] Using LLM Vision");
    return parseWithLLMVision(request);
  }

  throw new Error("没有可用的 OCR 服务。请在设置中配置 OCR 文档识别模型或 PaddleOCR 服务。");
}

/**
 * Check if vision-capable model is available
 * Returns true if:
 * 1. A dedicated vision config is configured, OR
 * 2. LLM config has a vision-capable model
 */
export async function isVisionAvailable(): Promise<boolean> {
  // First check if dedicated vision config is available
  const visionConfig = await getVisionConfig();
  if (visionConfig && visionConfig.enabled && visionConfig.defaultModel) {
    return true; // Assume vision config is always vision-capable
  }
  
  // Fall back to checking LLM config
  const llmConfig = await getLLMConfig();
  if (!llmConfig || !llmConfig.enabled || !llmConfig.defaultModel) {
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

  const modelLower = llmConfig.defaultModel.toLowerCase();
  return visionModels.some((vm) => modelLower.includes(vm.toLowerCase()));
}

/**
 * Check if PaddleOCR service is available
 */
export async function isPaddleOCRAvailable(): Promise<boolean> {
  const paddle = await checkPaddleOCR();
  return paddle.available;
}

/**
 * Get status of all OCR providers
 */
export async function getProviderStatus(): Promise<OCRProviderStatus> {
  const [visionConfig, llmConfig, paddle] = await Promise.all([
    getVisionConfig(),
    getLLMConfig(),
    checkPaddleOCR(),
  ]);

  // Check if vision config is LLM-based (not paddleocr)
  const llmVisionAvailable = visionConfig?.enabled && 
    visionConfig?.defaultModel && 
    visionConfig.providerId !== "paddleocr";
  
  // Or fall back to LLM config
  const llmFallbackAvailable = !llmVisionAvailable && 
    llmConfig?.enabled && 
    llmConfig?.defaultModel;

  return {
    llm: {
      available: llmVisionAvailable || llmFallbackAvailable,
      model: llmVisionAvailable ? visionConfig?.defaultModel : llmConfig?.defaultModel,
    },
    paddle: {
      available: paddle.available,
      endpoint: paddle.endpoint || undefined,
    },
  };
}

export const ocrService = {
  parseImage,
  isVisionAvailable,
  isPaddleOCRAvailable,
  getProviderStatus,
};
