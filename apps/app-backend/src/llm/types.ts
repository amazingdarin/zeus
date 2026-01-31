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
