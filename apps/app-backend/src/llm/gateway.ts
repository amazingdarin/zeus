/**
 * LLM Gateway
 *
 * Unified interface for chat, completion, and embedding operations
 * across multiple LLM providers.
 */

import { generateText, streamText, embed, embedMany, tool, zodSchema } from "ai";
import { z } from "zod";
import { providerRegistry } from "./providers.js";
import { traceManager } from "../observability/index.js";
import type {
  ChatOptions,
  ChatResponse,
  ChatOptionsWithTools,
  ChatResponseWithTools,
  OpenAIToolDef,
  ToolCall,
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

  // Start generation tracking if trace context is provided
  const startTime = new Date();
  const generation = options.traceContext
    ? traceManager.startGeneration(options.traceContext, {
        name: "chat",
        model: options.model,
        provider: options.provider,
        input: options.messages,
        startTime,
        metadata: {
          temperature: options.temperature,
          maxTokens: options.maxTokens,
          topP: options.topP,
        },
      })
    : null;

  try {
    const result = await generateText({
      model,
      messages: options.messages.map((m) => ({
        role: m.role,
        content: m.content as any, // Support both string and multimodal content
      })),
      temperature: options.temperature,
      maxOutputTokens: options.maxTokens,  // AI SDK 6.x renamed maxTokens to maxOutputTokens
      topP: options.topP,
    });

    console.log(`[LLM Gateway] generateText succeeded`);

    const usage = {
      promptTokens: result.usage?.inputTokens || 0,      // AI SDK 6.x renamed promptTokens to inputTokens
      completionTokens: result.usage?.outputTokens || 0, // AI SDK 6.x renamed completionTokens to outputTokens
      totalTokens: result.usage?.totalTokens || 0,
    };

    // End generation tracking
    traceManager.endGeneration(generation, result.text, usage);

    return {
      id: result.response?.id || crypto.randomUUID(),
      model: options.model,
      content: result.text,
      finishReason: result.finishReason || "stop",
      usage,
    };
  } catch (err) {
    console.error(`[LLM Gateway] generateText failed:`, err);

    // Log error to trace
    traceManager.endGeneration(
      generation,
      "",
      undefined,
      "ERROR",
      err instanceof Error ? err.message : String(err),
    );

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
 * Supports cancellation via abortSignal
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
      content: m.content as any, // Support both string and multimodal content
    })),
    temperature: options.temperature,
    maxOutputTokens: options.maxTokens,  // AI SDK 6.x renamed maxTokens to maxOutputTokens
    topP: options.topP,
    abortSignal: options.abortSignal, // Pass abort signal for cancellation support
  });

  return result;
}

/**
 * Chat with tools support (Function Calling)
 *
 * This function allows the LLM to choose and call tools based on the conversation.
 */
export async function chatWithTools(
  options: ChatOptionsWithTools,
): Promise<ChatResponseWithTools> {
  console.log(`[LLM Gateway] chatWithTools() called with:`, {
    provider: options.provider,
    model: options.model,
    baseUrl: options.baseUrl,
    hasApiKey: !!options.apiKey,
    messageCount: options.messages.length,
    toolCount: options.tools?.length || 0,
    toolChoice: options.tool_choice,
  });

  const model = providerRegistry.getLanguageModel(options.provider, options.model, {
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
  });

  // Convert OpenAI tool definitions to Vercel AI SDK format
  // We use type assertion because we're creating tools without execute functions
  // (the LLM will select tools, but we execute them ourselves)
  const vercelTools = options.tools
    ? (convertToVercelTools(options.tools) as Record<string, ReturnType<typeof tool>>)
    : undefined;

  // Start generation tracking if trace context is provided
  const startTime = new Date();
  const generation = options.traceContext
    ? traceManager.startGeneration(options.traceContext, {
        name: "chatWithTools",
        model: options.model,
        provider: options.provider,
        input: options.messages,
        startTime,
        metadata: {
          temperature: options.temperature,
          maxTokens: options.maxTokens,
          topP: options.topP,
          tools: options.tools?.map((t) => t.function.name),
          toolChoice: options.tool_choice,
        },
      })
    : null;

  try {
    const result = await generateText({
      model,
      messages: options.messages.map((m) => ({
        role: m.role,
        content: m.content as any,
      })),
      temperature: options.temperature,
      maxOutputTokens: options.maxTokens,  // AI SDK 6.x renamed maxTokens to maxOutputTokens
      topP: options.topP,
      tools: vercelTools,
      toolChoice: convertToolChoice(options.tool_choice),
    });

    console.log(`[LLM Gateway] chatWithTools succeeded, toolCalls:`, result.toolCalls?.length || 0);

    // Convert tool calls to our format
    const toolCalls: ToolCall[] | undefined = result.toolCalls?.map((tc) => ({
      id: tc.toolCallId,
      type: "function" as const,
      function: {
        name: tc.toolName,
        arguments: JSON.stringify(tc.input),
      },
    }));

    const usage = {
      promptTokens: result.usage?.inputTokens || 0,      // AI SDK 6.x renamed promptTokens to inputTokens
      completionTokens: result.usage?.outputTokens || 0, // AI SDK 6.x renamed completionTokens to outputTokens
      totalTokens: result.usage?.totalTokens || 0,
    };

    // End generation tracking with tool calls info
    traceManager.endGeneration(
      generation,
      JSON.stringify({ text: result.text, toolCalls }),
      usage,
    );

    return {
      id: result.response?.id || crypto.randomUUID(),
      model: options.model,
      content: result.text,
      finishReason: result.finishReason || "stop",
      toolCalls,
      usage,
    };
  } catch (err) {
    console.error(`[LLM Gateway] chatWithTools failed:`, err);

    // Log error to trace
    traceManager.endGeneration(
      generation,
      "",
      undefined,
      "ERROR",
      err instanceof Error ? err.message : String(err),
    );

    throw err;
  }
}

/**
 * Convert OpenAI tool definitions to Vercel AI SDK format
 */
function convertToVercelTools(
  tools: OpenAIToolDef[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const t of tools) {
    // Build zod schema from parameters
    const schemaShape: Record<string, z.ZodTypeAny> = {};

    for (const [key, prop] of Object.entries(t.function.parameters.properties)) {
      let zodType: z.ZodTypeAny;

      switch (prop.type) {
        case "string":
          zodType = prop.enum
            ? z.enum(prop.enum as [string, ...string[]])
            : z.string().describe(prop.description);
          break;
        case "number":
          zodType = z.number().describe(prop.description);
          break;
        case "boolean":
          zodType = z.boolean().describe(prop.description);
          break;
        case "array":
          zodType = z.array(z.any()).describe(prop.description);
          break;
        default:
          zodType = z.any().describe(prop.description);
      }

      // Make optional if not in required list
      if (!t.function.parameters.required.includes(key)) {
        zodType = zodType.optional();
      }

      schemaShape[key] = zodType;
    }

    // Use inputSchema instead of parameters (Vercel AI SDK 6.x format)
    result[t.function.name] = tool({
      description: t.function.description,
      inputSchema: zodSchema(z.object(schemaShape)),
    });
  }

  return result;
}

/**
 * Convert tool choice to Vercel AI SDK format
 */
function convertToolChoice(
  choice?: ChatOptionsWithTools["tool_choice"],
): "auto" | "none" | "required" | { type: "tool"; toolName: string } | undefined {
  if (!choice) return undefined;

  if (typeof choice === "string") {
    return choice;
  }

  // Convert { type: "function", function: { name: string } } to { type: "tool", toolName: string }
  if (choice.type === "function") {
    return {
      type: "tool",
      toolName: choice.function.name,
    };
  }

  return undefined;
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
    maxOutputTokens: options.maxTokens,  // AI SDK 6.x renamed maxTokens to maxOutputTokens
    topP: options.topP,
  });

  return {
    id: result.response?.id || crypto.randomUUID(),
    model: options.model,
    content: result.text,
    finishReason: result.finishReason || "stop",
    usage: {
      promptTokens: result.usage?.inputTokens || 0,      // AI SDK 6.x renamed promptTokens to inputTokens
      completionTokens: result.usage?.outputTokens || 0, // AI SDK 6.x renamed completionTokens to outputTokens
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

  // Start generation tracking if trace context is provided
  const startTime = new Date();
  const generation = options.traceContext
    ? traceManager.startGeneration(options.traceContext, {
        name: "embedding",
        model: options.model,
        provider: options.provider,
        input: { inputCount: options.inputs.length, totalChars: options.inputs.reduce((sum, t) => sum + t.length, 0) },
        startTime,
      })
    : null;

  try {
    if (options.inputs.length === 1) {
      // Single input
      const result = await embed({
        model,
        value: options.inputs[0],
      });

      const usage = {
        promptTokens: result.usage?.tokens || 0,
        totalTokens: result.usage?.tokens || 0,
      };

      // End generation tracking
      traceManager.endGeneration(
        generation,
        JSON.stringify({ embeddingDimensions: result.embedding.length }),
        { promptTokens: usage.promptTokens, totalTokens: usage.totalTokens },
      );

      return {
        model: options.model,
        embeddings: [result.embedding],
        usage,
      };
    }

    // Multiple inputs
    const result = await embedMany({
      model,
      values: options.inputs,
    });

    const usage = {
      promptTokens: result.usage?.tokens || 0,
      totalTokens: result.usage?.tokens || 0,
    };

    // End generation tracking
    traceManager.endGeneration(
      generation,
      JSON.stringify({ embeddingCount: result.embeddings.length, dimensions: result.embeddings[0]?.length }),
      { promptTokens: usage.promptTokens, totalTokens: usage.totalTokens },
    );

    return {
      model: options.model,
      embeddings: result.embeddings,
      usage,
    };
  } catch (err) {
    // Log error to trace
    traceManager.endGeneration(
      generation,
      "",
      undefined,
      "ERROR",
      err instanceof Error ? err.message : String(err),
    );
    throw err;
  }
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
  chatWithTools,
  complete,
  generateEmbeddings,
  listProviders,
  listModels,
  isProviderAvailable,
  parseModelString,
};
