import { v4 as uuidv4 } from "uuid";
import { configStore, llmGateway, type ProviderConfigInternal } from "../llm/index.js";
import { knowledgeSearch } from "../knowledge/search.js";
import { documentStore } from "../storage/document-store.js";
import type { SearchResult } from "../storage/types.js";

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type SourceReference = {
  docId: string;
  title: string;
  snippet: string;
  score: number;
};

export type ChatRun = {
  id: string;
  projectKey: string;
  sessionId: string;
  messages: ChatMessage[];
  status: "pending" | "running" | "completed" | "failed";
  createdAt: number;
  updatedAt: number;
};

export type ChatStreamChunk = {
  type: "delta" | "done" | "error";
  content?: string;
  message?: string;
  error?: string;
  sources?: SourceReference[];
};

// In-memory storage for active chat runs
const activeRuns = new Map<string, ChatRun>();
const sessionMessages = new Map<string, ChatMessage[]>();

// Cleanup old runs after 1 hour
const RUN_TTL = 60 * 60 * 1000;

function cleanupOldRuns() {
  const now = Date.now();
  for (const [runId, run] of activeRuns) {
    if (now - run.updatedAt > RUN_TTL) {
      activeRuns.delete(runId);
    }
  }
}

// Run cleanup every 10 minutes
setInterval(cleanupOldRuns, 10 * 60 * 1000);

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

/**
 * Create a new chat run
 */
export async function createRun(
  projectKey: string,
  sessionId: string,
  message: string,
): Promise<string> {
  const runId = uuidv4();
  
  // Get or create session messages
  let history = sessionMessages.get(sessionId);
  if (!history) {
    history = [];
    sessionMessages.set(sessionId, history);
  }

  // Add user message to history
  const userMessage: ChatMessage = { role: "user", content: message };
  history.push(userMessage);

  const run: ChatRun = {
    id: runId,
    projectKey,
    sessionId,
    messages: [...history],
    status: "pending",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  activeRuns.set(runId, run);
  return runId;
}

/**
 * Get a chat run by ID
 */
export function getRun(runId: string): ChatRun | null {
  return activeRuns.get(runId) || null;
}

/**
 * Stream a chat run response
 */
export async function* streamRun(runId: string): AsyncGenerator<ChatStreamChunk> {
  const run = activeRuns.get(runId);
  if (!run) {
    yield { type: "error", error: "Run not found" };
    return;
  }

  // Get LLM config
  const config = await getLLMConfig();
  if (!config || !config.enabled) {
    yield { type: "error", error: "No LLM provider configured. Please configure an LLM provider in settings." };
    run.status = "failed";
    run.updatedAt = Date.now();
    return;
  }

  if (!config.defaultModel) {
    yield { type: "error", error: "No default model configured for LLM provider." };
    run.status = "failed";
    run.updatedAt = Date.now();
    return;
  }

  run.status = "running";
  run.updatedAt = Date.now();

  // Track sources for RAG
  let sources: SourceReference[] = [];

  try {
    // Extract user's latest message for knowledge search
    const userQuery = run.messages[run.messages.length - 1]?.content || "";

    // Search knowledge base for relevant context
    let ragContext = "";
    try {
      const searchResults = await knowledgeSearch.search(
        run.projectKey,
        run.projectKey,
        {
          text: userQuery,
          mode: "hybrid",
          limit: 5,
        },
      );

      if (searchResults.length > 0) {
        const contextData = await buildContextFromResults(run.projectKey, searchResults);
        ragContext = contextData.text;
        sources = contextData.sources;
        console.log(`[chat] RAG: Found ${sources.length} relevant documents for query`);
      }
    } catch (searchErr) {
      // Log but don't fail - continue without RAG context
      console.warn("[chat] Knowledge search failed:", searchErr);
    }

    // Build messages for the LLM
    const llmMessages = run.messages.map((m) => ({
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
    }));

    // Add system prompt with RAG context
    const systemPrompt = buildSystemPromptWithContext(run.projectKey, ragContext);
    const messagesWithSystem = [
      { role: "system" as const, content: systemPrompt },
      ...llmMessages,
    ];

    // Call LLM gateway with streaming
    const stream = await llmGateway.chatStream({
      provider: config.providerId,
      model: config.defaultModel,
      messages: messagesWithSystem,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
    });

    let fullResponse = "";

    // Stream the response
    for await (const chunk of stream.textStream) {
      fullResponse += chunk;
      yield { type: "delta", content: chunk };
    }

    // Add assistant response to session history
    const history = sessionMessages.get(run.sessionId);
    if (history) {
      history.push({ role: "assistant", content: fullResponse });
    }

    run.status = "completed";
    run.updatedAt = Date.now();

    yield { type: "done", message: fullResponse, sources };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Chat failed";
    console.error("[chat] Stream error:", errorMessage);
    
    run.status = "failed";
    run.updatedAt = Date.now();
    
    yield { type: "error", error: errorMessage };
  }
}

/**
 * Build context from search results
 */
async function buildContextFromResults(
  projectKey: string,
  results: SearchResult[],
): Promise<{ text: string; sources: SourceReference[] }> {
  const sources: SourceReference[] = [];
  const contextParts: string[] = [];

  for (const result of results) {
    // Try to get document title
    let title = result.metadata?.title || "";
    if (!title) {
      try {
        const doc = await documentStore.get(projectKey, result.doc_id);
        title = doc.meta.title || result.doc_id;
      } catch {
        title = result.doc_id;
      }
    }

    sources.push({
      docId: result.doc_id,
      title,
      snippet: result.snippet,
      score: result.score,
    });

    // Build context text
    contextParts.push(`【${title}】\n${result.snippet}`);
  }

  return {
    text: contextParts.join("\n\n---\n\n"),
    sources,
  };
}

/**
 * Build system prompt with RAG context
 */
function buildSystemPromptWithContext(projectKey: string, context: string): string {
  const basePrompt = `你是 Zeus 文档管理系统的智能助手。当前项目: ${projectKey}`;

  if (!context) {
    return `${basePrompt}

你的职责:
1. 帮助用户管理和编辑文档
2. 回答关于项目内容的问题
3. 提供文档写作建议

请用中文回复，除非用户使用其他语言。保持回答简洁、专业。`;
  }

  return `${basePrompt}

## 相关文档内容
以下是与用户问题相关的文档片段，请基于这些内容回答：

${context}

## 回答要求
1. 优先使用上述文档内容回答问题
2. 如果文档内容不足以回答，可以结合通用知识补充
3. 引用具体文档时说明来源
4. 使用中文回答，保持专业简洁`;
}

/**
 * Clear session history
 */
export function clearSession(sessionId: string): void {
  sessionMessages.delete(sessionId);
}

/**
 * Get session message count
 */
export function getSessionMessageCount(sessionId: string): number {
  return sessionMessages.get(sessionId)?.length ?? 0;
}
