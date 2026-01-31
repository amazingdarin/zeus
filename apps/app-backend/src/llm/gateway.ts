/**
 * LLM Gateway
 *
 * Unified interface for chat, completion, and embedding operations
 * across multiple LLM providers.
 */

import { generateText, streamText, embed, embedMany } from "ai";
import { providerRegistry } from "./providers.js";
import type {
  ChatOptions,
  ChatResponse,
  CompletionOptions,
  CompletionResponse,
  EmbeddingOptions,
  EmbeddingResponse,
  ProviderInfo,
  ModelInfo,
} from "./types.js";

/**
 * Chat with an LLM model
 */
export async function chat(options: ChatOptions): Promise<ChatResponse> {
  console.log(`[LLM Gateway] chat() called with:`, {
    provider: options.provider,
    model: options.model,
    baseUrl: options.baseUrl,
    hasApiKey: !!options.apiKey,
    messageCount: options.messages.length,
  });

  const model = providerRegistry.getLanguageModel(options.provider, options.model, {
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
  });

  console.log(`[LLM Gateway] Got model instance, calling generateText...`);

  try {
    const result = await generateText({
      model,
      messages: options.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      topP: options.topP,
    });

    console.log(`[LLM Gateway] generateText succeeded`);

    return {
      id: result.response?.id || crypto.randomUUID(),
      model: options.model,
      content: result.text,
      finishReason: result.finishReason || "stop",
      usage: {
        promptTokens: result.usage?.promptTokens || 0,
        completionTokens: result.usage?.completionTokens || 0,
        totalTokens: result.usage?.totalTokens || 0,
      },
    };
  } catch (err) {
    console.error(`[LLM Gateway] generateText failed:`, err);
    // Try to extract more details from the error
    if (err && typeof err === "object") {
      const anyErr = err as Record<string, unknown>;
      if (anyErr.cause) {
        console.error(`[LLM Gateway] Error cause:`, anyErr.cause);
      }
      if (anyErr.response) {
        console.error(`[LLM Gateway] Error response:`, anyErr.response);
      }
      if (anyErr.data) {
        console.error(`[LLM Gateway] Error data:`, anyErr.data);
      }
    }
    throw err;
  }
}

/**
 * Stream chat with an LLM model
 */
export async function chatStream(options: ChatOptions) {
  const model = providerRegistry.getLanguageModel(options.provider, options.model, {
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
  });

  const result = streamText({
    model,
    messages: options.messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    topP: options.topP,
  });

  return result;
}

/**
 * Text completion with an LLM model
 */
export async function complete(options: CompletionOptions): Promise<CompletionResponse> {
  const model = providerRegistry.getLanguageModel(options.provider, options.model, {
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
  });

  const result = await generateText({
    model,
    prompt: options.prompt,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    topP: options.topP,
  });

  return {
    id: result.response?.id || crypto.randomUUID(),
    model: options.model,
    content: result.text,
    finishReason: result.finishReason || "stop",
    usage: {
      promptTokens: result.usage?.promptTokens || 0,
      completionTokens: result.usage?.completionTokens || 0,
      totalTokens: result.usage?.totalTokens || 0,
    },
  };
}

/**
 * Generate embeddings for text inputs
 */
export async function generateEmbeddings(
  options: EmbeddingOptions,
): Promise<EmbeddingResponse> {
  const model = providerRegistry.getEmbeddingModel(options.provider, options.model, {
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
  });

  if (options.inputs.length === 1) {
    // Single input
    const result = await embed({
      model,
      value: options.inputs[0],
    });

    return {
      model: options.model,
      embeddings: [result.embedding],
      usage: {
        promptTokens: result.usage?.tokens || 0,
        totalTokens: result.usage?.tokens || 0,
      },
    };
  }

  // Multiple inputs
  const result = await embedMany({
    model,
    values: options.inputs,
  });

  return {
    model: options.model,
    embeddings: result.embeddings,
    usage: {
      promptTokens: result.usage?.tokens || 0,
      totalTokens: result.usage?.tokens || 0,
    },
  };
}

/**
 * List available providers
 */
export function listProviders(): ProviderInfo[] {
  return providerRegistry.listProviders();
}

/**
 * List available models
 */
export function listModels(): ModelInfo[] {
  return providerRegistry.listModels();
}

/**
 * Check if a provider is available
 */
export function isProviderAvailable(providerId: string): boolean {
  return providerRegistry.isAvailable(providerId as any);
}

/**
 * Parse model string (e.g., "openai/gpt-4o") into provider and model ID
 */
export function parseModelString(modelString: string) {
  return providerRegistry.parseModelString(modelString);
}

/**
 * Export the gateway as a unified object
 */
export const llmGateway = {
  chat,
  chatStream,
  complete,
  generateEmbeddings,
  listProviders,
  listModels,
  isProviderAvailable,
  parseModelString,
};
