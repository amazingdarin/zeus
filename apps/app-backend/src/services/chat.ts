import { v4 as uuidv4 } from "uuid";
import { configStore, llmGateway, type ProviderConfigInternal } from "../llm/index.js";
import { knowledgeSearch } from "../knowledge/search.js";
import { documentStore } from "../storage/document-store.js";
import type { SearchResult } from "../storage/types.js";
import {
  executeSkillWithStream,
  analyzeTrigger,
  extractDocIdsFromArgs,
  type SkillStreamChunk,
  type DocumentDraft,
  type SkillIntent,
  type TriggerResult,
} from "../llm/skills/index.js";

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type SourceReference = {
  docId: string;
  blockId?: string;
  title: string;
  snippet: string;
  score: number;
};

export type DocumentScope = {
  docId: string;
  includeChildren: boolean;
};

export type ChatRun = {
  id: string;
  projectKey: string;
  sessionId: string;
  messages: ChatMessage[];
  docIds?: string[];  // Resolved document IDs for knowledge search scope
  status: "pending" | "running" | "completed" | "failed";
  createdAt: number;
  updatedAt: number;
};

export type ChatStreamChunk = {
  type: "delta" | "done" | "error" | "thinking" | "draft";
  content?: string;
  message?: string;
  error?: string;
  sources?: SourceReference[];
  draft?: DocumentDraft;
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
 * Resolve document scopes to a list of document IDs
 */
async function resolveDocumentScopes(
  projectKey: string,
  scopes: DocumentScope[],
): Promise<string[]> {
  const docIds = new Set<string>();

  for (const scope of scopes) {
    if (!scope.docId) continue;

    docIds.add(scope.docId);

    if (scope.includeChildren) {
      try {
        const descendantIds = await documentStore.collectAllDescendantIds(projectKey, scope.docId);
        for (const id of descendantIds) {
          docIds.add(id);
        }
      } catch {
        // Ignore errors, just use the parent doc
      }
    }
  }

  return Array.from(docIds);
}

/**
 * Create a new chat run
 */
export async function createRun(
  projectKey: string,
  sessionId: string,
  message: string,
  documentScope?: DocumentScope[],
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

  // Resolve document scopes to IDs
  let docIds: string[] | undefined;
  if (documentScope && documentScope.length > 0) {
    docIds = await resolveDocumentScopes(projectKey, documentScope);
    if (docIds.length === 0) {
      docIds = undefined; // No valid docs, search all
    }
  }

  const run: ChatRun = {
    id: runId,
    projectKey,
    sessionId,
    messages: [...history],
    docIds,
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
 *
 * Uses Hybrid Trigger to determine the appropriate mode:
 * - command: Explicit slash command (strong determinism)
 * - natural: Natural language with LLM tool selection
 * - chat: Regular conversation (RAG-based)
 */
export async function* streamRun(runId: string): AsyncGenerator<ChatStreamChunk> {
  const run = activeRuns.get(runId);
  if (!run) {
    yield { type: "error", error: "Run not found" };
    return;
  }

  run.status = "running";
  run.updatedAt = Date.now();

  // Extract user's latest message
  const userQuery = run.messages[run.messages.length - 1]?.content || "";

  // Analyze trigger mode
  const trigger = await analyzeTrigger(userQuery, run.docIds);
  console.log(`[chat] Trigger mode: ${trigger.mode}`);

  // Dispatch based on mode
  switch (trigger.mode) {
    case "command":
      yield* handleCommandMode(run, trigger);
      return;

    case "natural":
      yield* handleNaturalMode(run, trigger, userQuery);
      return;

    case "chat":
    default:
      yield* handleChatMode(run, userQuery);
      return;
  }
}

/**
 * Handle command mode - direct skill execution (strong determinism)
 */
async function* handleCommandMode(
  run: ChatRun,
  trigger: TriggerResult,
): AsyncGenerator<ChatStreamChunk> {
  if (!trigger.intent) {
    yield { type: "error", error: "No skill intent detected" };
    return;
  }

  console.log("[chat] Command mode, executing skill:", trigger.intent.skill);

  try {
    for await (const chunk of executeSkillWithStream(run.projectKey, trigger.intent)) {
      const mappedChunk = mapSkillChunkToChatChunk(chunk);
      yield mappedChunk;

      // If it's a draft, add a summary to session history
      if (chunk.type === "draft") {
        addDraftToHistory(run.sessionId, chunk.draft);
      }
    }

    run.status = "completed";
    run.updatedAt = Date.now();
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Skill execution failed";
    console.error("[chat] Command mode error:", errorMessage);

    run.status = "failed";
    run.updatedAt = Date.now();

    yield { type: "error", error: errorMessage };
  }
}

/**
 * Handle natural language mode - LLM selects tools
 */
async function* handleNaturalMode(
  run: ChatRun,
  trigger: TriggerResult,
  userQuery: string,
): AsyncGenerator<ChatStreamChunk> {
  const config = await getLLMConfig();
  if (!config?.enabled || !config.defaultModel) {
    // Fallback to chat mode if no LLM configured
    console.log("[chat] No LLM configured, falling back to chat mode");
    yield* handleChatMode(run, userQuery);
    return;
  }

  if (!trigger.tools || trigger.tools.length === 0) {
    // No tools available, fallback to chat mode
    console.log("[chat] No tools available, falling back to chat mode");
    yield* handleChatMode(run, userQuery);
    return;
  }

  console.log(
    "[chat] Natural mode with tools:",
    trigger.tools.map((t) => t.function.name),
  );

  try {
    // Build messages with tool-aware system prompt
    const systemPrompt = trigger.toolSystemPrompt || buildDefaultToolPrompt();
    const messages = [
      { role: "system" as const, content: systemPrompt },
      ...run.messages.map((m) => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
      })),
    ];

    // Add context about mentioned documents
    if (run.docIds && run.docIds.length > 0) {
      const docContext = `用户通过 @ 提到的文档 ID: ${run.docIds.join(", ")}`;
      messages.push({
        role: "system",
        content: docContext,
      });
    }

    // Call LLM with tools
    yield { type: "thinking", content: "正在分析请求..." };

    const response = await llmGateway.chatWithTools({
      provider: config.providerId,
      model: config.defaultModel,
      messages,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      tools: trigger.tools,
      tool_choice: "auto",
    });

    // Check if LLM selected a tool
    if (response.toolCalls && response.toolCalls.length > 0) {
      const toolCall = response.toolCalls[0];
      console.log("[chat] LLM selected tool:", toolCall.function.name);

      // Parse arguments
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch {
        console.warn("[chat] Failed to parse tool arguments:", toolCall.function.arguments);
      }

      // Build intent from tool call
      const intent: SkillIntent = {
        skill: toolCall.function.name,
        command: `/${toolCall.function.name}`,
        args,
        rawMessage: userQuery,
        docIds: extractDocIdsFromArgs(args, run.docIds),
      };

      yield { type: "thinking", content: `正在执行 ${toolCall.function.name}...` };

      // Execute the selected skill
      for await (const chunk of executeSkillWithStream(run.projectKey, intent)) {
        const mappedChunk = mapSkillChunkToChatChunk(chunk);
        yield mappedChunk;

        if (chunk.type === "draft") {
          addDraftToHistory(run.sessionId, chunk.draft);
        }
      }
    } else {
      // LLM decided not to use any tool, return its text response
      console.log("[chat] LLM did not select any tool, returning text response");
      
      if (response.content) {
        yield { type: "delta", content: response.content };
        
        // Add to history
        const history = sessionMessages.get(run.sessionId);
        if (history) {
          history.push({ role: "assistant", content: response.content });
        }
      }
      
      yield { type: "done", message: response.content };
    }

    run.status = "completed";
    run.updatedAt = Date.now();
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Natural mode failed";
    console.error("[chat] Natural mode error:", errorMessage);

    // Fallback to chat mode on error
    console.log("[chat] Falling back to chat mode due to error");
    yield* handleChatMode(run, userQuery);
  }
}

/**
 * Handle chat mode - regular RAG conversation
 */
async function* handleChatMode(
  run: ChatRun,
  userQuery: string,
): AsyncGenerator<ChatStreamChunk> {
  const config = await getLLMConfig();
  if (!config || !config.enabled) {
    yield {
      type: "error",
      error: "No LLM provider configured. Please configure an LLM provider in settings.",
    };
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

  // Track sources for RAG
  let sources: SourceReference[] = [];

  try {
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
          doc_ids: run.docIds,
        },
      );

      if (searchResults.length > 0) {
        const contextData = await buildContextFromResults(run.projectKey, searchResults);
        ragContext = contextData.text;
        sources = contextData.sources;
      }
    } catch (searchErr) {
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
    console.error("[chat] Chat mode error:", errorMessage);

    run.status = "failed";
    run.updatedAt = Date.now();

    yield { type: "error", error: errorMessage };
  }
}

/**
 * Map skill stream chunk to chat stream chunk
 */
function mapSkillChunkToChatChunk(chunk: SkillStreamChunk): ChatStreamChunk {
  switch (chunk.type) {
    case "delta":
      return { type: "delta", content: chunk.content };
    case "thinking":
      return { type: "thinking", content: chunk.content };
    case "draft":
      return { type: "draft", draft: chunk.draft };
    case "done":
      return { type: "done", message: chunk.message };
    case "error":
      return { type: "error", error: chunk.error };
    default:
      return { type: "error", error: "Unknown chunk type" };
  }
}

/**
 * Add draft summary to session history
 */
function addDraftToHistory(sessionId: string, draft: DocumentDraft): void {
  const history = sessionMessages.get(sessionId);
  if (history) {
    const draftType = draft.docId ? "编辑" : "创建";
    history.push({
      role: "assistant",
      content: `已生成${draftType}文档「${draft.title}」的草稿，请查看并确认。`,
    });
  }
}

/**
 * Build default tool-aware system prompt
 */
function buildDefaultToolPrompt(): string {
  return `你是 Zeus 文档管理系统的智能助手。

你可以使用工具帮助用户完成文档操作。
当用户明确表达创建、编辑、读取、优化文档的意图时，选择合适的工具。
如果用户只是提问或闲聊，直接回答，不要使用工具。`;
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
      blockId: result.block_id,
      title,
      snippet: result.snippet,
      score: result.score,
    });

    const locationHint = result.block_id ? ` (block: ${result.block_id.slice(0, 8)}...)` : "";
    contextParts.push(`【${title}${locationHint}】\n${result.snippet}`);
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
