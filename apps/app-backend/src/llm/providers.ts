/**
 * LLM Provider Registry
 *
 * Manages provider initialization and model resolution using Vercel AI SDK.
 * Supports both environment variable configuration and database-backed configuration.
 */

import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type {
  LLMProviderId,
  LLMProviderConfig,
  LLMModelConfig,
  ProviderInfo,
  ModelInfo,
} from "./types.js";
import { configStore, type ProviderConfigInternal } from "./config-store.js";

/**
 * Default model configurations
 */
const DEFAULT_MODELS: Record<LLMProviderId, LLMModelConfig[]> = {
  openai: [
    {
      id: "gpt-4o",
      name: "GPT-4o",
      providerId: "openai",
      capabilities: ["chat", "vision"],
      contextWindow: 128000,
      maxOutputTokens: 16384,
    },
    {
      id: "gpt-4o-mini",
      name: "GPT-4o Mini",
      providerId: "openai",
      capabilities: ["chat", "vision"],
      contextWindow: 128000,
      maxOutputTokens: 16384,
    },
    {
      id: "gpt-4-turbo",
      name: "GPT-4 Turbo",
      providerId: "openai",
      capabilities: ["chat", "vision"],
      contextWindow: 128000,
      maxOutputTokens: 4096,
    },
    {
      id: "gpt-3.5-turbo",
      name: "GPT-3.5 Turbo",
      providerId: "openai",
      capabilities: ["chat"],
      contextWindow: 16385,
      maxOutputTokens: 4096,
    },
    {
      id: "text-embedding-3-small",
      name: "Text Embedding 3 Small",
      providerId: "openai",
      capabilities: ["embedding"],
    },
    {
      id: "text-embedding-3-large",
      name: "Text Embedding 3 Large",
      providerId: "openai",
      capabilities: ["embedding"],
    },
  ],
  anthropic: [
    {
      id: "claude-sonnet-4-20250514",
      name: "Claude Sonnet 4",
      providerId: "anthropic",
      capabilities: ["chat", "vision"],
      contextWindow: 200000,
      maxOutputTokens: 8192,
    },
    {
      id: "claude-3-5-sonnet-20241022",
      name: "Claude 3.5 Sonnet",
      providerId: "anthropic",
      capabilities: ["chat", "vision"],
      contextWindow: 200000,
      maxOutputTokens: 8192,
    },
    {
      id: "claude-3-5-haiku-20241022",
      name: "Claude 3.5 Haiku",
      providerId: "anthropic",
      capabilities: ["chat", "vision"],
      contextWindow: 200000,
      maxOutputTokens: 8192,
    },
    {
      id: "claude-3-opus-20240229",
      name: "Claude 3 Opus",
      providerId: "anthropic",
      capabilities: ["chat", "vision"],
      contextWindow: 200000,
      maxOutputTokens: 4096,
    },
  ],
  google: [
    {
      id: "gemini-2.0-flash",
      name: "Gemini 2.0 Flash",
      providerId: "google",
      capabilities: ["chat", "vision"],
      contextWindow: 1000000,
      maxOutputTokens: 8192,
    },
    {
      id: "gemini-1.5-pro",
      name: "Gemini 1.5 Pro",
      providerId: "google",
      capabilities: ["chat", "vision"],
      contextWindow: 2000000,
      maxOutputTokens: 8192,
    },
    {
      id: "gemini-1.5-flash",
      name: "Gemini 1.5 Flash",
      providerId: "google",
      capabilities: ["chat", "vision"],
      contextWindow: 1000000,
      maxOutputTokens: 8192,
    },
    {
      id: "text-embedding-004",
      name: "Text Embedding 004",
      providerId: "google",
      capabilities: ["embedding"],
    },
  ],
  ollama: [
    {
      id: "llama3.2",
      name: "Llama 3.2",
      providerId: "ollama",
      capabilities: ["chat"],
      contextWindow: 128000,
    },
    {
      id: "llama3.1",
      name: "Llama 3.1",
      providerId: "ollama",
      capabilities: ["chat"],
      contextWindow: 128000,
    },
    {
      id: "qwen2.5",
      name: "Qwen 2.5",
      providerId: "ollama",
      capabilities: ["chat"],
      contextWindow: 32000,
    },
    {
      id: "deepseek-r1",
      name: "DeepSeek R1",
      providerId: "ollama",
      capabilities: ["chat"],
      contextWindow: 64000,
    },
    {
      id: "nomic-embed-text",
      name: "Nomic Embed Text",
      providerId: "ollama",
      capabilities: ["embedding"],
    },
    {
      id: "mxbai-embed-large",
      name: "mxbai Embed Large",
      providerId: "ollama",
      capabilities: ["embedding"],
    },
  ],
  "openai-compatible": [],
};

/**
 * Database-backed provider configuration (keyed by config id)
 */
type DbProviderConfig = ProviderConfigInternal & {
  configId: string;
};

/**
 * Provider registry singleton
 */
class ProviderRegistry {
  private providers = new Map<LLMProviderId, LLMProviderConfig>();
  private dbConfigs = new Map<string, DbProviderConfig>(); // keyed by config id
  private dbInitialized = false;

  constructor() {
    this.initializeFromEnv();
  }

  /**
   * Initialize providers from environment variables
   */
  private initializeFromEnv(): void {
    // OpenAI
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      this.providers.set("openai", {
        id: "openai",
        name: "OpenAI",
        apiKey: openaiKey,
        enabled: true,
        models: DEFAULT_MODELS.openai,
      });
    }

    // Anthropic
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (anthropicKey) {
      this.providers.set("anthropic", {
        id: "anthropic",
        name: "Anthropic",
        apiKey: anthropicKey,
        enabled: true,
        models: DEFAULT_MODELS.anthropic,
      });
    }

    // Google
    const googleKey = process.env.GOOGLE_API_KEY;
    if (googleKey) {
      this.providers.set("google", {
        id: "google",
        name: "Google",
        apiKey: googleKey,
        enabled: true,
        models: DEFAULT_MODELS.google,
      });
    }

    // Ollama (local, no API key required)
    const ollamaUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1";
    // Always enable Ollama if OLLAMA_BASE_URL is set, or check if localhost is available
    if (process.env.OLLAMA_BASE_URL) {
      this.providers.set("ollama", {
        id: "ollama",
        name: "Ollama (本地)",
        baseUrl: ollamaUrl,
        enabled: true,
        models: DEFAULT_MODELS.ollama,
      });
    }

    // OpenAI-compatible providers (e.g., Qwen, DeepSeek, etc.)
    this.initializeCompatibleProviders();
  }

  /**
   * Initialize OpenAI-compatible providers from environment
   */
  private initializeCompatibleProviders(): void {
    // Check for common OpenAI-compatible providers
    const compatibleProviders = [
      { prefix: "QWEN", name: "Qwen (通义千问)" },
      { prefix: "DEEPSEEK", name: "DeepSeek" },
      { prefix: "MOONSHOT", name: "Moonshot (Kimi)" },
      { prefix: "ZHIPU", name: "Zhipu (智谱)" },
      { prefix: "BAICHUAN", name: "Baichuan (百川)" },
    ];

    const models: LLMModelConfig[] = [];

    for (const { prefix, name } of compatibleProviders) {
      const apiKey = process.env[`${prefix}_API_KEY`];
      const baseUrl = process.env[`${prefix}_BASE_URL`];
      const modelId = process.env[`${prefix}_MODEL`];

      if (apiKey && baseUrl) {
        models.push({
          id: modelId || `${prefix.toLowerCase()}-default`,
          name: `${name} Default`,
          providerId: "openai-compatible",
          capabilities: ["chat"],
        });
      }
    }

    if (models.length > 0) {
      this.providers.set("openai-compatible", {
        id: "openai-compatible",
        name: "OpenAI Compatible",
        enabled: true,
        models,
      });
    }
  }

  /**
   * Load provider configurations from database
   */
  async loadFromDatabase(): Promise<void> {
    try {
      const configs = await configStore.listEnabled();
      this.dbConfigs.clear();

      for (const config of configs) {
        this.dbConfigs.set(config.id, {
          ...config,
          configId: config.id,
        });
      }

      this.dbInitialized = true;
    } catch (err) {
      console.error("Failed to load provider configs from database:", err);
    }
  }

  /**
   * Refresh database configurations
   */
  async refresh(): Promise<void> {
    await this.loadFromDatabase();
  }

  /**
   * Get a database-backed config by its ID
   */
  getDbConfig(configId: string): DbProviderConfig | undefined {
    return this.dbConfigs.get(configId);
  }

  /**
   * Get a database-backed config's credentials for runtime use
   */
  async getConfigCredentials(
    configId: string,
  ): Promise<{ apiKey?: string; baseUrl?: string } | null> {
    const config = await configStore.getInternal(configId);
    if (!config) return null;
    return {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
    };
  }

  /**
   * Get a provider configuration
   */
  getConfig(providerId: LLMProviderId): LLMProviderConfig | undefined {
    return this.providers.get(providerId);
  }

  /**
   * Check if a provider is available
   */
  isAvailable(providerId: LLMProviderId): boolean {
    const config = this.providers.get(providerId);
    return config?.enabled ?? false;
  }

  /**
   * Get the AI SDK provider instance for chat/completion
   * Supports both static (env) and dynamic (db) configurations
   */
  getLanguageModel(
    providerId: LLMProviderId,
    modelId: string,
    options?: { baseUrl?: string; apiKey?: string; configId?: string },
  ) {
    // If configId is provided, try to get credentials from database config
    let apiKey = options?.apiKey;
    let baseUrl = options?.baseUrl;

    if (options?.configId) {
      const dbConfig = this.dbConfigs.get(options.configId);
      if (dbConfig) {
        apiKey = apiKey || dbConfig.apiKey;
        baseUrl = baseUrl || dbConfig.baseUrl;
      }
    }

    const config = this.providers.get(providerId);

    switch (providerId) {
      case "openai": {
        const openai = createOpenAI({
          apiKey: apiKey || config?.apiKey,
          baseURL: baseUrl || config?.baseUrl,
        });
        return openai(modelId);
      }
      case "anthropic": {
        const anthropic = createAnthropic({
          apiKey: apiKey || config?.apiKey,
          baseURL: baseUrl || config?.baseUrl,
        });
        return anthropic(modelId);
      }
      case "google": {
        const google = createGoogleGenerativeAI({
          apiKey: apiKey || config?.apiKey,
          baseURL: baseUrl || config?.baseUrl,
        });
        return google(modelId);
      }
      case "ollama": {
        // Ollama uses OpenAI-compatible API, no API key required
        // Ensure baseUrl has /v1 suffix for OpenAI compatibility
        let ollamaBaseUrl = baseUrl || config?.baseUrl || "http://localhost:11434";
        if (!ollamaBaseUrl.endsWith("/v1")) {
          ollamaBaseUrl = ollamaBaseUrl.replace(/\/$/, "") + "/v1";
        }
        const openai = createOpenAI({
          apiKey: apiKey || "ollama", // Ollama doesn't need a real key, but SDK requires one
          baseURL: ollamaBaseUrl,
          compatibility: "compatible",
        });
        // Use .chat() to force chat completions API instead of responses API
        return openai.chat(modelId);
      }
      case "openai-compatible": {
        // For OpenAI-compatible providers, use OpenAI SDK with custom baseUrl
        const effectiveBaseUrl = baseUrl || config?.baseUrl || "";
        console.log(`[ProviderRegistry] Creating openai-compatible model:`, {
          modelId,
          baseUrl: effectiveBaseUrl,
          hasApiKey: !!(apiKey || config?.apiKey),
        });
        const openai = createOpenAI({
          apiKey: apiKey || config?.apiKey || "",
          baseURL: effectiveBaseUrl,
          compatibility: "compatible",
        });
        // Use .chat() to force Chat Completions API instead of Responses API
        // Most OpenAI-compatible providers (DashScope, DeepSeek, etc.) don't support the Responses API
        return openai.chat(modelId);
      }
      default:
        throw new Error(`Unknown provider: ${providerId}`);
    }
  }

  /**
   * Get the AI SDK embedding model instance
   * Supports both static (env) and dynamic (db) configurations
   */
  getEmbeddingModel(
    providerId: LLMProviderId,
    modelId: string,
    options?: { baseUrl?: string; apiKey?: string; configId?: string },
  ) {
    // If configId is provided, try to get credentials from database config
    let apiKey = options?.apiKey;
    let baseUrl = options?.baseUrl;

    if (options?.configId) {
      const dbConfig = this.dbConfigs.get(options.configId);
      if (dbConfig) {
        apiKey = apiKey || dbConfig.apiKey;
        baseUrl = baseUrl || dbConfig.baseUrl;
      }
    }

    const config = this.providers.get(providerId);

    switch (providerId) {
      case "openai":
      case "openai-compatible": {
        const openai = createOpenAI({
          apiKey: apiKey || config?.apiKey,
          baseURL: baseUrl || config?.baseUrl,
          compatibility: providerId === "openai-compatible" ? "compatible" : "strict",
        });
        return openai.embedding(modelId);
      }
      case "ollama": {
        // Ollama uses OpenAI-compatible embedding API
        // Ensure baseUrl has /v1 suffix for OpenAI compatibility
        let ollamaBaseUrl = baseUrl || config?.baseUrl || "http://localhost:11434";
        if (!ollamaBaseUrl.endsWith("/v1")) {
          ollamaBaseUrl = ollamaBaseUrl.replace(/\/$/, "") + "/v1";
        }
        const openai = createOpenAI({
          apiKey: apiKey || "ollama",
          baseURL: ollamaBaseUrl,
          compatibility: "compatible",
        });
        return openai.embedding(modelId);
      }
      case "google": {
        const google = createGoogleGenerativeAI({
          apiKey: apiKey || config?.apiKey,
          baseURL: baseUrl || config?.baseUrl,
        });
        return google.textEmbeddingModel(modelId);
      }
      case "anthropic":
        throw new Error("Anthropic does not support embedding models");
      default:
        throw new Error(`Unknown provider: ${providerId}`);
    }
  }

  /**
   * List all database-backed configurations
   */
  listDbConfigs(): DbProviderConfig[] {
    return Array.from(this.dbConfigs.values());
  }

  /**
   * List all available providers
   */
  listProviders(): ProviderInfo[] {
    const result: ProviderInfo[] = [];

    for (const [, config] of this.providers) {
      if (!config.enabled) continue;

      const models: ModelInfo[] = config.models.map((m) => ({
        id: m.id,
        name: m.name,
        capabilities: m.capabilities,
      }));

      result.push({
        id: config.id,
        name: config.name,
        enabled: config.enabled,
        models,
      });
    }

    return result;
  }

  /**
   * List all available models across providers
   */
  listModels(): ModelInfo[] {
    const result: ModelInfo[] = [];

    for (const [, config] of this.providers) {
      if (!config.enabled) continue;

      for (const model of config.models) {
        result.push({
          id: `${config.id}/${model.id}`,
          name: `${config.name} - ${model.name}`,
          capabilities: model.capabilities,
        });
      }
    }

    return result;
  }

  /**
   * Parse a model string like "openai/gpt-4o" into provider and model ID
   */
  parseModelString(modelString: string): { providerId: LLMProviderId; modelId: string } {
    const parts = modelString.split("/");
    if (parts.length === 2) {
      return {
        providerId: parts[0] as LLMProviderId,
        modelId: parts[1],
      };
    }
    // Default to OpenAI if no provider specified
    return {
      providerId: "openai",
      modelId: modelString,
    };
  }
}

/**
 * Singleton instance
 */
export const providerRegistry = new ProviderRegistry();
