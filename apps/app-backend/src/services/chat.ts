import { v4 as uuidv4 } from "uuid";
import { configStore, llmGateway, type ProviderConfigInternal } from "../llm/index.js";
import { knowledgeSearch } from "../knowledge/search.js";
import { documentStore } from "../storage/document-store.js";
import type { SearchResult } from "../storage/types.js";
import {
  executeSkillWithStream,
  executeAnthropicSkillWithStream,
  analyzeTrigger,
  extractDocIdsFromArgs,
  skillRegistry,
  type SkillStreamChunk,
  type DocumentDraft,
  type SkillIntent,
  type TriggerResult,
  type PendingToolCall,
  type SkillDefinition,
  type RiskLevel,
} from "../llm/skills/index.js";
import { executeDeepSearch, type DeepSearchChunk, type DeepSearchConfig } from "./deep-search.js";
import { traceManager, type TraceContext } from "../observability/index.js";

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type SourceReference = {
  type?: "kb" | "web";  // "kb" = knowledge base (default), "web" = web search
  docId?: string;       // For KB sources
  blockId?: string;     // For KB sources
  url?: string;         // For web sources
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
  deepSearch?: boolean;  // Enable deep search mode
  status: "pending" | "running" | "completed" | "failed" | "cancelled" | "awaiting_confirmation";
  pendingTool?: PendingToolCall;  // Tool awaiting user confirmation
  pendingIntent?: SkillIntent;    // Intent to execute after confirmation
  createdAt: number;
  updatedAt: number;
};

// Store AbortControllers for active runs (separate from ChatRun to avoid serialization issues)
const runAbortControllers = new Map<string, AbortController>();

export type ChatStreamChunk = {
  type: "delta" | "done" | "error" | "thinking" | "draft" | "tool_pending" | "tool_rejected" | "search_start" | "search_result";
  content?: string;
  message?: string;
  error?: string;
  sources?: SourceReference[];
  draft?: DocumentDraft;
  pendingTool?: PendingToolCall;  // For tool_pending type
  // Deep search specific fields
  phase?: "decompose" | "search_kb" | "evaluate" | "search_web" | "synthesize";
  subQueries?: string[];
  searchQuery?: string;
  resultCount?: number;
};

// In-memory storage for active chat runs
const activeRuns = new Map<string, ChatRun>();
const sessionMessages = new Map<string, ChatMessage[]>();

// Pending tool confirmation timeout (5 minutes)
const PENDING_TOOL_TTL = 5 * 60 * 1000;

// Event emitters for pending tool confirmation
// Map of runId -> resolve function for confirmation waiting
const pendingConfirmations = new Map<string, {
  resolve: (confirmed: boolean) => void;
  timeout: ReturnType<typeof setTimeout>;
}>();

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

export type CreateRunOptions = {
  deepSearch?: boolean;  // Enable deep search mode
};

/**
 * Create a new chat run
 */
export async function createRun(
  projectKey: string,
  sessionId: string,
  message: string,
  documentScope?: DocumentScope[],
  options?: CreateRunOptions,
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
    deepSearch: options?.deepSearch,
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
 * Cancel a running chat run
 * @returns true if the run was cancelled, false if not found or already completed
 */
export function cancelRun(runId: string): boolean {
  const run = activeRuns.get(runId);
  if (!run) {
    return false;
  }

  // Only cancel if running or pending
  if (run.status !== "running" && run.status !== "pending") {
    return false;
  }

  // Abort the controller if exists
  const controller = runAbortControllers.get(runId);
  if (controller) {
    controller.abort();
    runAbortControllers.delete(runId);
  }

  run.status = "cancelled";
  run.updatedAt = Date.now();
  console.log(`[chat] Run ${runId} cancelled`);
  return true;
}

/**
 * Get the AbortSignal for a run (creates one if not exists)
 */
function getOrCreateAbortSignal(runId: string): AbortSignal {
  let controller = runAbortControllers.get(runId);
  if (!controller) {
    controller = new AbortController();
    runAbortControllers.set(runId, controller);
  }
  return controller.signal;
}

/**
 * Check if a run is aborted
 */
function isRunAborted(runId: string): boolean {
  const controller = runAbortControllers.get(runId);
  return controller?.signal.aborted ?? false;
}

/**
 * Clean up abort controller for a run
 */
function cleanupAbortController(runId: string): void {
  runAbortControllers.delete(runId);
}

// ============================================================================
// Tool Confirmation Logic
// ============================================================================

/**
 * Check if a skill requires confirmation before execution
 */
function shouldRequireConfirmation(skill: SkillDefinition): boolean {
  return skill.confirmation?.required === true;
}

/**
 * Create a pending tool call for confirmation
 */
function createPendingToolCall(
  skill: SkillDefinition,
  args: Record<string, unknown>,
): PendingToolCall {
  const now = Date.now();
  return {
    id: uuidv4(),
    skillName: skill.name,
    skillDescription: skill.description,
    args,
    riskLevel: skill.confirmation?.riskLevel || "medium",
    warningMessage: skill.confirmation?.warningMessage,
    createdAt: now,
    expiresAt: now + PENDING_TOOL_TTL,
  };
}

/**
 * Wait for user confirmation on a pending tool
 * Returns true if confirmed, false if rejected or timeout
 */
async function waitForConfirmation(runId: string): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      // Timeout - treat as rejection
      pendingConfirmations.delete(runId);
      resolve(false);
    }, PENDING_TOOL_TTL);

    pendingConfirmations.set(runId, { resolve, timeout });
  });
}

/**
 * Confirm a pending tool execution
 */
export function confirmTool(runId: string): boolean {
  const run = activeRuns.get(runId);
  if (!run || run.status !== "awaiting_confirmation") {
    return false;
  }

  const pending = pendingConfirmations.get(runId);
  if (pending) {
    clearTimeout(pending.timeout);
    pending.resolve(true);
    pendingConfirmations.delete(runId);
  }

  return true;
}

/**
 * Reject a pending tool execution
 */
export function rejectTool(runId: string): boolean {
  const run = activeRuns.get(runId);
  if (!run || run.status !== "awaiting_confirmation") {
    return false;
  }

  const pending = pendingConfirmations.get(runId);
  if (pending) {
    clearTimeout(pending.timeout);
    pending.resolve(false);
    pendingConfirmations.delete(runId);
  }

  run.status = "completed";
  run.pendingTool = undefined;
  run.pendingIntent = undefined;
  run.updatedAt = Date.now();

  return true;
}

/**
 * Get the pending tool for a run
 */
export function getPendingTool(runId: string): PendingToolCall | undefined {
  const run = activeRuns.get(runId);
  return run?.pendingTool;
}

/**
 * Stream a chat run response
 *
 * Uses Hybrid Trigger to determine the appropriate mode:
 * - deepSearch: Multi-round search with question decomposition
 * - command: Explicit slash command (strong determinism)
 * - anthropic: Anthropic Skill keyword match (medium determinism)
 * - natural: Natural language with LLM tool selection
 * - chat: Regular conversation (RAG-based)
 */
export async function* streamRun(runId: string): AsyncGenerator<ChatStreamChunk> {
  const run = activeRuns.get(runId);
  if (!run) {
    yield { type: "error", error: "Run not found" };
    return;
  }

  // Create abort signal for this run
  const abortSignal = getOrCreateAbortSignal(runId);

  run.status = "running";
  run.updatedAt = Date.now();

  // Extract user's latest message
  const userQuery = run.messages[run.messages.length - 1]?.content || "";

  // Create trace for observability
  const traceContext = traceManager.startTrace(runId, {
    sessionId: run.sessionId,
    projectKey: run.projectKey,
    tags: ["chat"],
    metadata: {
      docIds: run.docIds,
      deepSearch: run.deepSearch,
    },
  });

  // Update trace with input
  traceManager.updateTrace(traceContext, { input: userQuery });

  try {
    // Check for deep search mode first
    if (run.deepSearch) {
      console.log("[chat] Deep search mode enabled");
      yield* handleDeepSearchMode(run, userQuery, abortSignal, traceContext);
      return;
    }

    // Analyze trigger mode
    const trigger = await analyzeTrigger(userQuery, run.docIds);
    console.log(`[chat] Trigger mode: ${trigger.mode}`);

    // Dispatch based on mode
    switch (trigger.mode) {
      case "command":
        yield* handleCommandMode(run, trigger, abortSignal, traceContext);
        return;

      case "anthropic":
        yield* handleAnthropicMode(run, trigger, abortSignal, traceContext);
        return;

      case "natural":
        yield* handleNaturalMode(run, trigger, userQuery, abortSignal, traceContext);
        return;

      case "chat":
      default:
        yield* handleChatMode(run, userQuery, abortSignal, traceContext);
        return;
    }
  } finally {
    // End trace and cleanup
    traceManager.endTrace(runId);
    cleanupAbortController(runId);
  }
}

/**
 * Handle command mode - direct skill execution (strong determinism)
 */
async function* handleCommandMode(
  run: ChatRun,
  trigger: TriggerResult,
  abortSignal: AbortSignal,
  traceContext: TraceContext,
): AsyncGenerator<ChatStreamChunk> {
  if (!trigger.intent) {
    yield { type: "error", error: "No skill intent detected" };
    return;
  }

  console.log("[chat] Command mode, executing skill:", trigger.intent.skill);

  // Create span for skill execution
  const skillSpan = traceManager.startSpan(traceContext, `skill:${trigger.intent.skill}`, {
    command: trigger.intent.command,
    args: trigger.intent.args,
  });

  try {
    for await (const chunk of executeSkillWithStream(run.projectKey, trigger.intent, traceContext)) {
      // Check if aborted
      if (abortSignal.aborted) {
        console.log("[chat] Command mode aborted");
        run.status = "cancelled";
        run.updatedAt = Date.now();
        return;
      }

      const mappedChunk = mapSkillChunkToChatChunk(chunk);
      yield mappedChunk;

      // If it's a draft, add a summary to session history
      if (chunk.type === "draft") {
        addDraftToHistory(run.sessionId, chunk.draft);
      }
    }

    // End skill span
    traceManager.endSpan(skillSpan, { status: "completed" });

    run.status = "completed";
    run.updatedAt = Date.now();
  } catch (err) {
    // Check if it's an abort error
    if (abortSignal.aborted) {
      traceManager.endSpan(skillSpan, { status: "cancelled" }, "WARNING");
      run.status = "cancelled";
      run.updatedAt = Date.now();
      return;
    }

    const errorMessage = err instanceof Error ? err.message : "Skill execution failed";
    console.error("[chat] Command mode error:", errorMessage);

    // End skill span with error
    traceManager.endSpan(skillSpan, { error: errorMessage }, "ERROR");

    run.status = "failed";
    run.updatedAt = Date.now();

    yield { type: "error", error: errorMessage };
  }
}

/**
 * Handle Anthropic mode - execute Anthropic Skill (medium determinism)
 */
async function* handleAnthropicMode(
  run: ChatRun,
  trigger: TriggerResult,
  abortSignal: AbortSignal,
  traceContext: TraceContext,
): AsyncGenerator<ChatStreamChunk> {
  if (!trigger.anthropicSkill || !trigger.userRequest) {
    yield { type: "error", error: "No Anthropic skill matched" };
    return;
  }

  const skill = trigger.anthropicSkill;
  console.log("[chat] Anthropic mode, executing skill:", skill.name);

  // Create span for anthropic skill
  const skillSpan = traceManager.startSpan(traceContext, `anthropic:${skill.name}`, {
    userRequest: trigger.userRequest,
  });

  try {
    // Build context from referenced documents
    let context: string | undefined;
    if (run.docIds && run.docIds.length > 0) {
      try {
        const docs = await Promise.all(
          run.docIds.slice(0, 3).map(async (docId) => {
            const doc = await documentStore.get(run.projectKey, docId);
            return `## ${doc.meta.title}\n${JSON.stringify(doc.body)}`;
          }),
        );
        context = docs.join("\n\n---\n\n");
      } catch {
        // Ignore errors loading context
      }
    }

    // Execute Anthropic Skill
    for await (const chunk of executeAnthropicSkillWithStream(
      run.projectKey,
      skill,
      trigger.userRequest,
      context,
      traceContext,
    )) {
      // Check if aborted
      if (abortSignal.aborted) {
        console.log("[chat] Anthropic mode aborted");
        traceManager.endSpan(skillSpan, { status: "cancelled" }, "WARNING");
        run.status = "cancelled";
        run.updatedAt = Date.now();
        return;
      }

      const mappedChunk = mapSkillChunkToChatChunk(chunk);
      yield mappedChunk;
    }

    traceManager.endSpan(skillSpan, { status: "completed" });
    run.status = "completed";
    run.updatedAt = Date.now();
  } catch (err) {
    // Check if it's an abort error
    if (abortSignal.aborted) {
      traceManager.endSpan(skillSpan, { status: "cancelled" }, "WARNING");
      run.status = "cancelled";
      run.updatedAt = Date.now();
      return;
    }

    const errorMessage = err instanceof Error ? err.message : "Anthropic skill execution failed";
    console.error("[chat] Anthropic mode error:", errorMessage);

    traceManager.endSpan(skillSpan, { error: errorMessage }, "ERROR");
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
  abortSignal: AbortSignal,
  traceContext: TraceContext,
): AsyncGenerator<ChatStreamChunk> {
  const config = await getLLMConfig();
  if (!config?.enabled || !config.defaultModel) {
    // Fallback to chat mode if no LLM configured
    console.log("[chat] No LLM configured, falling back to chat mode");
    yield* handleChatMode(run, userQuery, abortSignal, traceContext);
    return;
  }

  if (!trigger.tools || trigger.tools.length === 0) {
    // No tools available, fallback to chat mode
    console.log("[chat] No tools available, falling back to chat mode");
    yield* handleChatMode(run, userQuery, abortSignal, traceContext);
    return;
  }

  // Check if already aborted
  if (abortSignal.aborted) {
    run.status = "cancelled";
    run.updatedAt = Date.now();
    return;
  }

  console.log(
    "[chat] Natural mode with tools:",
    trigger.tools.map((t) => t.function.name),
  );

  // Create span for tool selection
  const toolSelectionSpan = traceManager.startSpan(traceContext, "tool-selection", {
    availableTools: trigger.tools.map((t) => t.function.name),
  });

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
      traceContext,
    });

    // Check if aborted after LLM call
    if (abortSignal.aborted) {
      run.status = "cancelled";
      run.updatedAt = Date.now();
      return;
    }

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

      // Check if skill requires confirmation
      const skill = skillRegistry.getNativeByName(toolCall.function.name);
      if (skill && shouldRequireConfirmation(skill)) {
        console.log("[chat] Skill requires confirmation:", skill.name);

        // Create pending tool and pause for confirmation
        const pendingTool = createPendingToolCall(skill, args);
        run.status = "awaiting_confirmation";
        run.pendingTool = pendingTool;
        run.pendingIntent = intent;
        run.updatedAt = Date.now();

        // Yield pending tool event
        yield { type: "tool_pending", pendingTool };

        // Wait for user confirmation
        const confirmed = await waitForConfirmation(run.id);

        if (!confirmed) {
          console.log("[chat] Tool execution rejected or timed out");
          run.pendingTool = undefined;
          run.pendingIntent = undefined;
          run.status = "completed";
          run.updatedAt = Date.now();
          yield { type: "tool_rejected", message: "操作已取消" };
          return;
        }

        console.log("[chat] Tool execution confirmed");
        run.pendingTool = undefined;
        run.pendingIntent = undefined;
        run.status = "running";
        run.updatedAt = Date.now();
      }

      yield { type: "thinking", content: `正在执行 ${toolCall.function.name}...` };

      // End tool selection span before skill execution
      traceManager.endSpan(toolSelectionSpan, { selectedTool: toolCall.function.name });

      // Execute the selected skill
      for await (const chunk of executeSkillWithStream(run.projectKey, intent, traceContext)) {
        // Check if aborted
        if (abortSignal.aborted) {
          console.log("[chat] Natural mode aborted during skill execution");
          run.status = "cancelled";
          run.updatedAt = Date.now();
          return;
        }

        const mappedChunk = mapSkillChunkToChatChunk(chunk);
        yield mappedChunk;

        if (chunk.type === "draft") {
          addDraftToHistory(run.sessionId, chunk.draft);
        }
      }
    } else {
      // LLM decided not to use any tool, return its text response
      console.log("[chat] LLM did not select any tool, returning text response");
      
      // End tool selection span
      traceManager.endSpan(toolSelectionSpan, { selectedTool: null });
      
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
    // Check if it's an abort error
    if (abortSignal.aborted) {
      traceManager.endSpan(toolSelectionSpan, { status: "cancelled" }, "WARNING");
      run.status = "cancelled";
      run.updatedAt = Date.now();
      return;
    }

    const errorMessage = err instanceof Error ? err.message : "Natural mode failed";
    console.error("[chat] Natural mode error:", errorMessage);

    traceManager.endSpan(toolSelectionSpan, { error: errorMessage }, "ERROR");

    // Fallback to chat mode on error
    console.log("[chat] Falling back to chat mode due to error");
    yield* handleChatMode(run, userQuery, abortSignal, traceContext);
  }
}

/**
 * Handle chat mode - regular RAG conversation
 */
async function* handleChatMode(
  run: ChatRun,
  userQuery: string,
  abortSignal: AbortSignal,
  traceContext: TraceContext,
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

  // Check if already aborted
  if (abortSignal.aborted) {
    run.status = "cancelled";
    run.updatedAt = Date.now();
    return;
  }

  // Create span for chat mode
  const chatSpan = traceManager.startSpan(traceContext, "chat-rag", {
    query: userQuery,
    docIds: run.docIds,
  });

  // Track sources for RAG
  let sources: SourceReference[] = [];

  try {
    // Search knowledge base for relevant context
    let ragContext = "";
    const searchSpan = traceManager.startSpan(traceContext, "knowledge-search", {
      query: userQuery,
      mode: "hybrid",
    });
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
      traceManager.endSpan(searchSpan, { resultCount: searchResults.length });
    } catch (searchErr) {
      console.warn("[chat] Knowledge search failed:", searchErr);
      traceManager.endSpan(searchSpan, { error: String(searchErr) }, "WARNING");
    }

    // Check if aborted after search
    if (abortSignal.aborted) {
      traceManager.endSpan(chatSpan, { status: "cancelled" }, "WARNING");
      run.status = "cancelled";
      run.updatedAt = Date.now();
      return;
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

    // Call LLM gateway with streaming and abort signal
    const stream = await llmGateway.chatStream({
      provider: config.providerId,
      model: config.defaultModel,
      messages: messagesWithSystem,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      abortSignal,
      traceContext,
    });

    let fullResponse = "";

    // Stream the response
    for await (const chunk of stream.textStream) {
      // Check if aborted during streaming
      if (abortSignal.aborted) {
        console.log("[chat] Chat mode aborted during streaming");
        traceManager.endSpan(chatSpan, { status: "cancelled", partialResponse: fullResponse.length }, "WARNING");
        run.status = "cancelled";
        run.updatedAt = Date.now();
        
        // Still save partial response to history if any
        if (fullResponse) {
          const history = sessionMessages.get(run.sessionId);
          if (history) {
            history.push({ role: "assistant", content: fullResponse + "\n\n[已停止]" });
          }
        }
        return;
      }

      fullResponse += chunk;
      yield { type: "delta", content: chunk };
    }

    // Add assistant response to session history
    const history = sessionMessages.get(run.sessionId);
    if (history) {
      history.push({ role: "assistant", content: fullResponse });
    }

    // Update trace with output
    traceManager.updateTrace(traceContext, { output: fullResponse });
    traceManager.endSpan(chatSpan, { responseLength: fullResponse.length, sourceCount: sources.length });

    run.status = "completed";
    run.updatedAt = Date.now();

    yield { type: "done", message: fullResponse, sources };
  } catch (err) {
    // Check if it's an abort error
    if (abortSignal.aborted || (err instanceof Error && err.name === "AbortError")) {
      console.log("[chat] Chat mode aborted");
      traceManager.endSpan(chatSpan, { status: "cancelled" }, "WARNING");
      run.status = "cancelled";
      run.updatedAt = Date.now();
      return;
    }

    const errorMessage = err instanceof Error ? err.message : "Chat failed";
    console.error("[chat] Chat mode error:", errorMessage);

    traceManager.endSpan(chatSpan, { error: errorMessage }, "ERROR");
    run.status = "failed";
    run.updatedAt = Date.now();

    yield { type: "error", error: errorMessage };
  }
}

/**
 * Handle deep search mode - multi-round search with synthesis
 */
async function* handleDeepSearchMode(
  run: ChatRun,
  userQuery: string,
  abortSignal: AbortSignal,
  traceContext: TraceContext,
): AsyncGenerator<ChatStreamChunk> {
  // Create span for deep search
  const deepSearchSpan = traceManager.startSpan(traceContext, "deep-search", {
    query: userQuery,
    docIds: run.docIds,
  });

  try {
    for await (const chunk of executeDeepSearch(
      run.projectKey,
      userQuery,
      run.docIds,
      undefined, // Use default config
      abortSignal,
    )) {
      // Check if aborted
      if (abortSignal.aborted) {
        console.log("[chat] Deep search mode aborted");
        traceManager.endSpan(deepSearchSpan, { status: "cancelled" }, "WARNING");
        run.status = "cancelled";
        run.updatedAt = Date.now();
        return;
      }

      // Map deep search chunk to chat chunk
      const chatChunk = mapDeepSearchChunkToChatChunk(chunk);
      yield chatChunk;

      // Update status when done
      if (chunk.type === "done") {
        traceManager.endSpan(deepSearchSpan, { status: "completed" });
        traceManager.updateTrace(traceContext, { output: chunk.message });
        run.status = "completed";
        run.updatedAt = Date.now();

        // Add response to session history
        if (chunk.message) {
          const history = sessionMessages.get(run.sessionId);
          if (history) {
            history.push({ role: "assistant", content: chunk.message });
          }
        }
      }
    }
  } catch (err) {
    // Check if it's an abort error
    if (abortSignal.aborted) {
      traceManager.endSpan(deepSearchSpan, { status: "cancelled" }, "WARNING");
      run.status = "cancelled";
      run.updatedAt = Date.now();
      return;
    }

    const errorMessage = err instanceof Error ? err.message : "Deep search failed";
    console.error("[chat] Deep search mode error:", errorMessage);

    traceManager.endSpan(deepSearchSpan, { error: errorMessage }, "ERROR");
    run.status = "failed";
    run.updatedAt = Date.now();

    yield { type: "error", error: errorMessage };
  }
}

/**
 * Map deep search chunk to chat chunk
 */
function mapDeepSearchChunkToChatChunk(chunk: DeepSearchChunk): ChatStreamChunk {
  switch (chunk.type) {
    case "thinking":
      return {
        type: "thinking",
        content: chunk.content,
        phase: chunk.phase,
        subQueries: chunk.subQueries,
      };
    case "search_start":
      return {
        type: "search_start",
        content: chunk.content,
        phase: chunk.phase,
        searchQuery: chunk.searchQuery,
      };
    case "search_result":
      return {
        type: "search_result",
        content: chunk.content,
        phase: chunk.phase,
        searchQuery: chunk.searchQuery,
        resultCount: chunk.resultCount,
      };
    case "delta":
      return { type: "delta", content: chunk.content };
    case "done":
      return {
        type: "done",
        message: chunk.message,
        sources: chunk.sources,
      };
    case "error":
      return { type: "error", error: chunk.error };
    default:
      return { type: "error", error: "Unknown deep search chunk type" };
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
