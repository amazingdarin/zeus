/**
 * LLM Gateway Type Definitions
 */

/**
 * Supported LLM provider identifiers
 */
export type LLMProviderId =
  | "openai"
  | "anthropic"
  | "google"
  | "ollama"
  | "openai-compatible"
  | "paddleocr";

/**
 * Provider configuration
 */
export type LLMProviderConfig = {
  id: LLMProviderId;
  name: string;
  apiKey?: string;
  baseUrl?: string;
  enabled: boolean;
  models: LLMModelConfig[];
};

/**
 * Model configuration
 */
export type LLMModelConfig = {
  id: string;
  name: string;
  providerId: LLMProviderId;
  capabilities: LLMCapability[];
  contextWindow?: number;
  maxOutputTokens?: number;
};

/**
 * Model capabilities
 */
export type LLMCapability = "chat" | "completion" | "embedding" | "vision";

/**
 * Chat message role
 */
export type ChatRole = "system" | "user" | "assistant" | "tool";

/**
 * Image content part for vision models
 */
export type ImageContentPart = {
  type: "image";
  image: string | URL; // base64 data URL or HTTP URL
};

/**
 * Text content part
 */
export type TextContentPart = {
  type: "text";
  text: string;
};

/**
 * Multimodal content for vision-capable models
 */
export type MessageContent = string | (TextContentPart | ImageContentPart)[];

/**
 * Chat message
 */
export type ChatMessage = {
  role: ChatRole;
  content: MessageContent;
  name?: string;
};

/**
 * Chat request options
 */
export type ChatOptions = {
  provider: LLMProviderId;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stream?: boolean;
  // OpenAI-compatible provider config
  baseUrl?: string;
  apiKey?: string;
  // Abort signal for cancellation
  abortSignal?: AbortSignal;
};

/**
 * Chat response
 */
export type ChatResponse = {
  id: string;
  model: string;
  content: string;
  finishReason: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
};

/**
 * Completion request options
 */
export type CompletionOptions = {
  provider: LLMProviderId;
  model: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stream?: boolean;
  // OpenAI-compatible provider config
  baseUrl?: string;
  apiKey?: string;
};

/**
 * Completion response
 */
export type CompletionResponse = {
  id: string;
  model: string;
  content: string;
  finishReason: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
};

/**
 * Embedding request options
 */
export type EmbeddingOptions = {
  provider: LLMProviderId;
  model: string;
  inputs: string[];
  // OpenAI-compatible provider config
  baseUrl?: string;
  apiKey?: string;
};

/**
 * Embedding response
 */
export type EmbeddingResponse = {
  model: string;
  embeddings: number[][];
  usage: {
    promptTokens: number;
    totalTokens: number;
  };
};

/**
 * Provider info for listing
 */
export type ProviderInfo = {
  id: LLMProviderId;
  name: string;
  enabled: boolean;
  models: ModelInfo[];
};

/**
 * Model info for listing
 */
export type ModelInfo = {
  id: string;
  name: string;
  capabilities: LLMCapability[];
};

// ============================================================================
// Tool Calling Types (OpenAI Function Calling compatible)
// ============================================================================

/**
 * OpenAI-compatible tool definition
 */
export type OpenAIToolDef = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<
        string,
        {
          type: string;
          description: string;
          enum?: string[];
        }
      >;
      required: string[];
    };
  };
};

/**
 * Tool call returned by LLM
 */
export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
};

/**
 * Tool choice options
 */
export type ToolChoice =
  | "auto" // LLM decides whether to use a tool
  | "none" // LLM should not use any tool
  | "required" // LLM must use a tool
  | { type: "function"; function: { name: string } }; // Force specific tool

/**
 * Chat options with tools support
 */
export type ChatOptionsWithTools = ChatOptions & {
  tools?: OpenAIToolDef[];
  tool_choice?: ToolChoice;
};

/**
 * Chat response with tool calls
 */
export type ChatResponseWithTools = ChatResponse & {
  toolCalls?: ToolCall[];
};
