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
  type OrganizePlan,
  type SkillIntent,
  type TriggerResult,
  type PendingToolCall,
  type SkillDefinition,
  type RiskLevel,
} from "../llm/skills/index.js";
import { applyOrganizePlan } from "./organize.js";
import { runDraftRefinementLoop } from "../llm/skills/refinement-loop.js";
import {
  agentOrchestrator,
  agentPolicyEngine,
  mcpClientManager,
  type AgentPlan,
  type AgentSkillDefinition,
} from "../llm/agent/index.js";
import { executeDeepSearch, type DeepSearchChunk, type DeepSearchConfig } from "./deep-search.js";
import { traceManager, type TraceContext } from "../observability/index.js";
import {
  executeChatGraph,
  resumeChatGraph,
  resumeChatGraphWithIntent,
  resumeChatGraphWithRequiredInput,
  type ChatExecutionPlan,
  type ChatGraphResult,
  type GraphSourceReference,
  type IntentOption,
  type PendingIntentInfo,
} from "./chat-graph.js";
import { chatSettingsStore } from "./chat-settings-store.js";
import { chatSessionStore } from "./chat-session-store.js";
import { draftService } from "./draft.js";

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

export type ChatAttachmentRef = {
  assetId: string;
  name?: string;
  mimeType?: string;
  size?: number;
  type?: string;
};

export type ChatRun = {
  id: string;
  userId: string;
  projectKey: string;
  sessionId: string;
  messages: ChatMessage[];
  docIds?: string[];  // Resolved document IDs for knowledge search scope
  attachments?: ChatAttachmentRef[];
  deepSearch?: boolean;  // Enable deep search mode
  status:
    | "pending"
    | "running"
    | "completed"
    | "failed"
    | "cancelled"
    | "awaiting_confirmation"
    | "awaiting_intent"
    | "awaiting_input";
  pendingTool?: PendingToolCall;  // Tool awaiting user confirmation
  pendingIntent?: SkillIntent;    // Intent to execute after confirmation
  pendingIntentInfo?: import("./chat-graph.js").PendingIntentInfo;  // Intent clarification
  pendingRequiredInput?: import("./chat-graph.js").PendingRequiredInputInfo;  // Required input clarification
  createdAt: number;
  updatedAt: number;
};

// Store AbortControllers for active runs (separate from ChatRun to avoid serialization issues)
const runAbortControllers = new Map<string, AbortController>();

export type ChatStreamChunk = {
  type:
    | "delta"
    | "done"
    | "error"
    | "thinking"
    | "draft"
    | "tool_pending"
    | "tool_rejected"
    | "intent_pending"
    | "input_pending"
    | "search_start"
    | "search_result";
  content?: string;
  message?: string;
  error?: string;
  sources?: SourceReference[];
  draft?: DocumentDraft;
  pendingTool?: PendingToolCall;  // For tool_pending type
  pendingIntent?: import("./chat-graph.js").PendingIntentInfo;  // For intent_pending type
  pendingInput?: import("./chat-graph.js").PendingRequiredInputInfo;  // For input_pending type
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

// Event emitters for pending intent selection
const pendingIntentSelections = new Map<string, {
  resolve: (option: IntentOption | null) => void;
  timeout: ReturnType<typeof setTimeout>;
}>();

// Pending required input collection
const pendingRequiredInputs = new Map<string, {
  resolve: (payload: { doc_id: string } | null) => void;
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

function parseEnvBool(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return defaultValue;
  return normalized !== "false" && normalized !== "0" && normalized !== "no";
}

function parseEnvInt(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

const DOC_GUARD_ENABLED = parseEnvBool("DOC_GUARD_ENABLED", true);
const DOC_GUARD_MAX_ATTEMPTS = parseEnvInt("DOC_GUARD_MAX_ATTEMPTS", 3);

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
  userId: string,
  projectKey: string,
  scopes: DocumentScope[],
): Promise<string[]> {
  const docIds = new Set<string>();

  for (const scope of scopes) {
    if (!scope.docId) continue;

    docIds.add(scope.docId);

    if (scope.includeChildren) {
      try {
        const descendantIds = await documentStore.collectAllDescendantIds(userId, projectKey, scope.docId);
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
  attachments?: ChatAttachmentRef[];
};

/**
 * Create a new chat run
 */
export async function createRun(
  userId: string,
  projectKey: string,
  sessionId: string,
  message: string,
  documentScope?: DocumentScope[],
  options?: CreateRunOptions,
): Promise<string> {
  const runId = uuidv4();

  // Ensure session exists in DB (auto-create if not)
  try {
    const existing = await chatSessionStore.getSession(sessionId);
    if (!existing) {
      await chatSessionStore.createSession(userId, projectKey, "新对话");
      // Use the returned id — but we need to keep the caller's sessionId.
      // Actually, if the frontend provides a sessionId we should use it.
      // So we create with a specific id:
      // We'll use a direct insert with the given id instead.
      // Let's delete the auto-created one and re-insert with the right id.
      // Simpler: just do a raw insert with the provided sessionId.
    }
  } catch {
    // Ignore — session may already exist or DB unavailable
  }
  await ensureSessionExists(userId, projectKey, sessionId);

  // Load history from DB (or fall back to in-memory cache)
  let history = sessionMessages.get(sessionId);
  if (!history) {
    try {
      const dbMessages = await chatSessionStore.getMessages(sessionId);
      history = dbMessages.map((m) => ({
        role: m.role as ChatMessage["role"],
        content: m.content,
      }));
    } catch {
      history = [];
    }
    sessionMessages.set(sessionId, history);
  }

  // Add user message to history and persist
  const userMessage: ChatMessage = { role: "user", content: message };
  history.push(userMessage);

  // Persist user message to DB (fire-and-forget)
  chatSessionStore
    .addMessage(sessionId, "user", message)
    .then(() => chatSessionStore.updateSessionTimestamp(sessionId))
    .catch((err) => {
      console.warn("[chat] Failed to persist user message:", err);
    });

  // Resolve document scopes to IDs
  let docIds: string[] | undefined;
  if (documentScope && documentScope.length > 0) {
    docIds = await resolveDocumentScopes(userId, projectKey, documentScope);
    if (docIds.length === 0) {
      docIds = undefined; // No valid docs, search all
    }
  }

  const run: ChatRun = {
    id: runId,
    userId,
    projectKey,
    sessionId,
    messages: [...history],
    docIds,
    attachments: options?.attachments,
    deepSearch: options?.deepSearch,
    status: "pending",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  activeRuns.set(runId, run);
  return runId;
}

/**
 * Ensure a session exists in the DB with a specific ID.
 */
async function ensureSessionExists(userId: string, projectKey: string, sessionId: string): Promise<void> {
  try {
    // Use INSERT ... ON CONFLICT to avoid race conditions
    await import("../db/postgres.js").then(({ query }) =>
      query(
        `INSERT INTO chat_sessions (id, user_id, project_key, title, created_at, updated_at)
         VALUES ($1, $2, $3, $4, now(), now())
         ON CONFLICT (id) DO NOTHING`,
        [sessionId, userId, projectKey, "新对话"],
      ),
    );
  } catch (err) {
    console.warn("[chat] ensureSessionExists failed:", err);
  }
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

  // Only cancel if the run is still active or waiting on user input
  if (
    run.status !== "running"
    && run.status !== "pending"
    && run.status !== "awaiting_confirmation"
    && run.status !== "awaiting_intent"
    && run.status !== "awaiting_input"
  ) {
    return false;
  }

  // Abort the controller if exists
  const controller = runAbortControllers.get(runId);
  if (controller) {
    controller.abort();
    runAbortControllers.delete(runId);
  }

  // If waiting for tool confirmation, resolve as rejected.
  const pendingTool = pendingConfirmations.get(runId);
  if (pendingTool) {
    clearTimeout(pendingTool.timeout);
    pendingTool.resolve(false);
    pendingConfirmations.delete(runId);
  }

  // If waiting for intent selection, resolve as timeout (null).
  const pendingIntent = pendingIntentSelections.get(runId);
  if (pendingIntent) {
    clearTimeout(pendingIntent.timeout);
    pendingIntent.resolve(null);
    pendingIntentSelections.delete(runId);
  }

  // If waiting for required input, resolve as timeout (null).
  const pendingInput = pendingRequiredInputs.get(runId);
  if (pendingInput) {
    clearTimeout(pendingInput.timeout);
    pendingInput.resolve(null);
    pendingRequiredInputs.delete(runId);
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

function createPendingToolCallForAgent(
  skill: AgentSkillDefinition,
  args: Record<string, unknown>,
): PendingToolCall {
  const now = Date.now();
  return {
    id: uuidv4(),
    skillName: skill.displayName,
    skillDescription: skill.description,
    args,
    riskLevel: skill.risk.level as RiskLevel,
    warningMessage: skill.risk.warningMessage,
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
 * Wait for user to provide required input (e.g. doc scope)
 */
async function waitForRequiredInput(runId: string): Promise<{ doc_id: string } | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingRequiredInputs.delete(runId);
      resolve(null);
    }, PENDING_TOOL_TTL);

    pendingRequiredInputs.set(runId, { resolve, timeout });
  });
}

/**
 * Provide required input for a pending input clarification
 */
export function provideRequiredInput(runId: string, payload: { doc_id: string }): boolean {
  const run = activeRuns.get(runId);
  if (!run || run.status !== "awaiting_input") {
    return false;
  }

  const pending = pendingRequiredInputs.get(runId);
  if (pending) {
    clearTimeout(pending.timeout);
    pending.resolve(payload);
    pendingRequiredInputs.delete(runId);
  }

  return true;
}

/**
 * Wait for user to select an intent option
 * Returns the selected option or null on timeout
 */
async function waitForIntentSelection(runId: string): Promise<IntentOption | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingIntentSelections.delete(runId);
      resolve(null);
    }, PENDING_TOOL_TTL);

    pendingIntentSelections.set(runId, { resolve, timeout });
  });
}

/**
 * Select an intent option for a pending intent clarification
 */
export function selectIntent(runId: string, selectedOption: IntentOption): boolean {
  const run = activeRuns.get(runId);
  if (!run || run.status !== "awaiting_intent") {
    return false;
  }

  const pending = pendingIntentSelections.get(runId);
  if (pending) {
    clearTimeout(pending.timeout);
    pending.resolve(selectedOption);
    pendingIntentSelections.delete(runId);
  }

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
 * Three-phase execution using LangGraph:
 *   Phase 1: Graph planning (intent detection → routing → skill planning → policy check)
 *   Phase 2: Human-in-the-loop (if graph interrupted for confirmation)
 *   Phase 3: Streaming execution based on the plan
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
    name: "chat",
    userId: run.userId,
    sessionId: run.sessionId,
    projectKey: run.projectKey,
    tags: ["chat"],
    metadata: {
      docIds: run.docIds,
      deepSearch: run.deepSearch,
      attachmentCount: run.attachments?.length ?? 0,
    },
  });

  // Update trace with input
  traceManager.updateTrace(traceContext, { input: userQuery });

  try {
    // ──────────────── Phase 1: LangGraph Planning ────────────────
    let planSpan = traceManager.startSpan(traceContext, "chat-graph-plan", {
      query: userQuery,
    });

    // Read global chat settings (cached, 1-min TTL)
    const chatSettings = await chatSettingsStore.get();

    let graphResult: ChatGraphResult;
    try {
      graphResult = await executeChatGraph(runId, {
        userQuery,
        messages: run.messages,
        projectKey: run.projectKey,
        userId: run.userId,
        sessionId: run.sessionId,
        docIds: run.docIds,
        attachments: run.attachments,
        deepSearchRequested: run.deepSearch,
        fullAccess: chatSettings.fullAccess,
        traceContext,
      });
    } catch (graphErr) {
      const errMsg = graphErr instanceof Error ? graphErr.message : "Chat graph failed";
      console.error("[chat] Chat graph error:", errMsg);
      traceManager.endSpan(planSpan, { error: errMsg }, "ERROR");
      run.status = "failed";
      run.updatedAt = Date.now();
      yield { type: "error", error: errMsg };
      return;
    }

    console.log(
      `[chat] Graph result status: ${graphResult.status}, intent: ${graphResult.intent.type} (${graphResult.intent.confidence})`,
    );

    // ──────────────── Phase 1-2: Graph Interrupt Handling Loop ────────────────
    // The graph can interrupt multiple times (intent selection, then tool confirmation).
    // Each graph invocation (execute/resume) gets its own planning span.
    while (graphResult.status !== "complete") {
      if (abortSignal.aborted) {
        traceManager.endSpan(planSpan, { status: "cancelled" }, "WARNING");
        run.status = "cancelled";
        run.updatedAt = Date.now();
        return;
      }

      // ──────────────── Phase 1.5: Intent Clarification ────────────────
      if (graphResult.status === "awaiting_intent") {
        traceManager.endSpan(planSpan, {
          intent: graphResult.intent.type,
          planAction: "awaiting_intent",
          candidates: graphResult.pendingIntent.options.length,
        });

        run.status = "awaiting_intent";
        run.pendingIntentInfo = graphResult.pendingIntent;
        run.updatedAt = Date.now();
        yield { type: "intent_pending", pendingIntent: graphResult.pendingIntent };

        // Wait for user to select an intent option
        const selected = await waitForIntentSelection(runId);

        run.pendingIntentInfo = undefined;

        if (abortSignal.aborted) {
          run.status = "cancelled";
          run.updatedAt = Date.now();
          return;
        }

        // Timeout — fall back to chat
        const option = selected || {
          type: "chat" as const,
          label: "直接对话",
          confidence: 1.0,
        };

        run.status = "running";
        run.updatedAt = Date.now();

        planSpan = traceManager.startSpan(traceContext, "chat-graph-plan-resume-intent", {
          selected: option.label,
          type: option.type,
          skillHint: option.skillHint,
        });

        try {
          graphResult = await resumeChatGraphWithIntent(runId, option);
        } catch (resumeErr) {
          const errMsg = resumeErr instanceof Error ? resumeErr.message : "Graph resume failed";
          console.error("[chat] Graph resume (intent) error:", errMsg);
          traceManager.endSpan(planSpan, { error: errMsg }, "ERROR");
          run.status = "failed";
          run.updatedAt = Date.now();
          yield { type: "error", error: errMsg };
          return;
        }

        console.log(
          `[chat] After intent selection: ${graphResult.status}, intent: ${graphResult.intent.type}`,
        );
        continue;
      }

      if (graphResult.status === "awaiting_input") {
        traceManager.endSpan(planSpan, {
          intent: graphResult.intent.type,
          planAction: "awaiting_input",
          kind: graphResult.pendingInput.kind,
          skill: graphResult.pendingInput.skillName,
        });

        run.status = "awaiting_input";
        run.pendingRequiredInput = graphResult.pendingInput;
        run.updatedAt = Date.now();
        yield { type: "input_pending", pendingInput: graphResult.pendingInput };

        const provided = await waitForRequiredInput(runId);
        run.pendingRequiredInput = undefined;

        if (abortSignal.aborted) {
          run.status = "cancelled";
          run.updatedAt = Date.now();
          return;
        }

        const payload = provided || { doc_id: "" };

        run.status = "running";
        run.updatedAt = Date.now();

        planSpan = traceManager.startSpan(traceContext, "chat-graph-plan-resume-input", {
          kind: graphResult.pendingInput.kind,
          skill: graphResult.pendingInput.skillName,
          doc_id: payload.doc_id ? payload.doc_id : undefined,
        });

        try {
          graphResult = await resumeChatGraphWithRequiredInput(runId, payload);
        } catch (resumeErr) {
          const errMsg = resumeErr instanceof Error ? resumeErr.message : "Graph resume failed";
          console.error("[chat] Graph resume (input) error:", errMsg);
          traceManager.endSpan(planSpan, { error: errMsg }, "ERROR");
          run.status = "failed";
          run.updatedAt = Date.now();
          yield { type: "error", error: errMsg };
          return;
        }

        continue;
      }

      // ──────────────── Phase 2: Human-in-the-Loop (Tool Confirmation) ────────────────
      if (graphResult.status === "awaiting_confirmation") {
        traceManager.endSpan(planSpan, {
          intent: graphResult.intent.type,
          planAction: "awaiting_confirmation",
          skill: graphResult.pendingTool.skillName,
        });

        // Build a PendingToolCall for the SSE event
        const pendingTool = createPendingToolCallFromGraphInfo(graphResult.pendingTool);
        run.status = "awaiting_confirmation";
        run.pendingTool = pendingTool;
        run.updatedAt = Date.now();
        yield { type: "tool_pending", pendingTool };

        // Wait for user confirmation (via confirmTool / rejectTool endpoints)
        const confirmed = await waitForConfirmation(runId);

        run.pendingTool = undefined;

        if (abortSignal.aborted) {
          run.status = "cancelled";
          run.updatedAt = Date.now();
          return;
        }

        // Resume graph with the user's decision (false = rejected/timeout)
        run.status = "running";
        run.updatedAt = Date.now();

        planSpan = traceManager.startSpan(traceContext, "chat-graph-plan-resume-confirmation", {
          confirmed,
          skill: pendingTool.skillName,
        });

        try {
          graphResult = await resumeChatGraph(runId, confirmed && !abortSignal.aborted);
        } catch (resumeErr) {
          const errMsg = resumeErr instanceof Error ? resumeErr.message : "Graph resume failed";
          console.error("[chat] Graph resume error:", errMsg);
          traceManager.endSpan(planSpan, { error: errMsg }, "ERROR");
          run.status = "failed";
          run.updatedAt = Date.now();
          yield { type: "error", error: errMsg };
          return;
        }

        if (!confirmed || abortSignal.aborted) {
          traceManager.endSpan(planSpan, { status: "rejected" }, "WARNING");
          run.status = "completed";
          run.updatedAt = Date.now();
          yield { type: "tool_rejected", message: "操作已取消" };
          return;
        }

        console.log(
          `[chat] After tool confirmation: ${graphResult.status}, intent: ${graphResult.intent.type}`,
        );
        continue;
      }

      // Unexpected interrupt type
      traceManager.endSpan(planSpan, { error: "Unexpected graph interrupt" }, "ERROR");
      run.status = "failed";
      run.updatedAt = Date.now();
      yield { type: "error", error: "Unexpected graph interrupt" };
      return;
    }

    // Graph is complete — end the last planning span with the final plan action.
    traceManager.endSpan(planSpan, {
      intent: graphResult.intent.type,
      planAction: graphResult.plan.action,
    });

    if (abortSignal.aborted) {
      run.status = "cancelled";
      run.updatedAt = Date.now();
      return;
    }

    // ──────────────── Phase 3: Streaming Execution ────────────────
    // At this point graphResult.status is always "complete"
    const plan = graphResult.plan;
    console.log(`[chat] Executing plan: ${plan.action}`);

    switch (plan.action) {
      case "stream_chat":
        yield* executeStreamChat(run, plan, abortSignal, traceContext);
        return;

      case "execute_skill":
        yield* executeSkillPlan(run, plan, userQuery, abortSignal, traceContext, chatSettings.fullAccess);
        return;

      case "deep_search":
        yield* handleDeepSearchMode(run, userQuery, abortSignal, traceContext);
        return;

      case "respond_text": {
        if (plan.text.trim()) {
          yield { type: "delta", content: plan.text };
        }
        const history = sessionMessages.get(run.sessionId);
        if (history) history.push({ role: "assistant", content: plan.text });
        run.status = "completed";
        run.updatedAt = Date.now();
        persistAssistantMessage(run.sessionId, plan.text);
        yield { type: "done", message: plan.text };
        return;
      }

      case "respond_blocked": {
        const msg = plan.reason || "操作被禁止";
        yield { type: "delta", content: msg };
        const history = sessionMessages.get(run.sessionId);
        if (history) history.push({ role: "assistant", content: msg });
        run.status = "completed";
        run.updatedAt = Date.now();
        yield { type: "done", message: msg };
        return;
      }

      case "respond_rejected": {
        // This case is reached when the graph handled rejection internally
        yield { type: "tool_rejected", message: plan.reason || "操作已取消" };
        run.status = "completed";
        run.updatedAt = Date.now();
        return;
      }

      case "respond_error":
        yield { type: "error", error: plan.error };
        run.status = "failed";
        run.updatedAt = Date.now();
        return;
    }
  } finally {
    // End trace and cleanup
    traceManager.endTrace(runId);
    cleanupAbortController(runId);
  }
}

// ============================================================================
// Plan Executors
// ============================================================================

/**
 * Execute stream_chat plan: stream LLM response with pre-built RAG context
 */
async function* executeStreamChat(
  run: ChatRun,
  plan: Extract<ChatExecutionPlan, { action: "stream_chat" }>,
  abortSignal: AbortSignal,
  traceContext: TraceContext,
): AsyncGenerator<ChatStreamChunk> {
  const config = await getLLMConfig();
  if (!config?.enabled || !config.defaultModel) {
    yield { type: "error", error: "LLM 未配置" };
    run.status = "failed";
    run.updatedAt = Date.now();
    return;
  }

  const chatSpan = traceManager.startSpan(traceContext, "stream-chat", {
    hasRagContext: !!plan.ragContext,
    sourceCount: plan.ragSources.length,
  });

  try {
    const llmMessages = run.messages.map((m) => ({
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
    }));
    const messagesWithSystem = [
      { role: "system" as const, content: plan.systemPrompt },
      ...llmMessages,
    ];

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
    for await (const chunk of stream.textStream) {
      if (abortSignal.aborted) {
        traceManager.endSpan(chatSpan, { status: "cancelled", partialResponse: fullResponse.length }, "WARNING");
        run.status = "cancelled";
        run.updatedAt = Date.now();
        if (fullResponse) {
          const history = sessionMessages.get(run.sessionId);
          if (history) history.push({ role: "assistant", content: fullResponse + "\n\n[已停止]" });
        }
        return;
      }
      fullResponse += chunk;
      yield { type: "delta", content: chunk };
    }

    const history = sessionMessages.get(run.sessionId);
    if (history) history.push({ role: "assistant", content: fullResponse });

    // Map GraphSourceReference[] to SourceReference[]
    const sources: SourceReference[] = plan.ragSources.map((s) => ({
      type: s.type,
      docId: s.docId,
      blockId: s.blockId,
      url: s.url,
      title: s.title,
      snippet: s.snippet,
      score: s.score,
    }));

    traceManager.updateTrace(traceContext, { output: fullResponse });
    traceManager.endSpan(chatSpan, { responseLength: fullResponse.length, sourceCount: sources.length });

    run.status = "completed";
    run.updatedAt = Date.now();

    // Persist assistant message to DB
    persistAssistantMessage(run.sessionId, fullResponse, sources);

    yield { type: "done", message: fullResponse, sources };
  } catch (err) {
    if (abortSignal.aborted || (err instanceof Error && err.name === "AbortError")) {
      traceManager.endSpan(chatSpan, { status: "cancelled" }, "WARNING");
      run.status = "cancelled";
      run.updatedAt = Date.now();
      return;
    }
    const errorMessage = err instanceof Error ? err.message : "Chat failed";
    console.error("[chat] Stream chat error:", errorMessage);
    traceManager.endSpan(chatSpan, { error: errorMessage }, "ERROR");
    run.status = "failed";
    run.updatedAt = Date.now();
    yield { type: "error", error: errorMessage };
  }
}

/**
 * Execute a skill plan by delegating to the existing handleAgentExecuteMode.
 * Policy check and confirmation have already been handled by the graph.
 */
async function* executeSkillPlan(
  run: ChatRun,
  plan: Extract<ChatExecutionPlan, { action: "execute_skill" }>,
  userQuery: string,
  abortSignal: AbortSignal,
  traceContext: TraceContext,
  fullAccess = false,
): AsyncGenerator<ChatStreamChunk> {
  // Map sourceIntent from graph format to AgentPlan format
  const sourceIntent: "command" | "anthropic-keyword" | "tool" =
    plan.sourceIntent === "llm-tool"
      ? "tool"
      : plan.sourceIntent === "keyword"
        ? "anthropic-keyword"
        : "command";

  // Delegate to existing handler, but skip its internal policy check
  // and confirmation logic since the graph already handled those.
  yield* executeSkillDirect(run, plan.skill, plan.args, plan.docIds, sourceIntent, userQuery, abortSignal, traceContext, fullAccess);
}

/**
 * Execute a skill directly (post-policy, post-confirmation).
 * This is the skill execution core extracted from handleAgentExecuteMode,
 * without the policy check and confirmation logic.
 */
async function* executeSkillDirect(
  run: ChatRun,
  skill: AgentSkillDefinition,
  args: Record<string, unknown>,
  docIds: string[],
  sourceIntent: "command" | "anthropic-keyword" | "tool",
  userQuery: string,
  abortSignal: AbortSignal,
  traceContext: TraceContext,
  fullAccess = false,
): AsyncGenerator<ChatStreamChunk> {
  const skillSpan = traceManager.startSpan(traceContext, `agent:${skill.id}`, {
    source: skill.source,
    toolName: skill.toolName,
    args,
    sourceIntent,
    fullAccess,
  });

  const isDraftProducingLegacySkill = (legacyName: string): boolean => {
    return legacyName === "doc-create"
      || legacyName === "doc-edit"
      || legacyName === "doc-summary"
      || legacyName.startsWith("doc-optimize-");
  };

  try {
    if (skill.source === "native") {
      const intent = buildIntentFromAgentPlan(skill, args, userQuery, docIds);
      if (!intent) {
        throw new Error(`Missing legacy skill mapping for native skill: ${skill.id}`);
      }

      const shouldGuard = DOC_GUARD_ENABLED && isDraftProducingLegacySkill(intent.skill);

      if (shouldGuard) {
        let skipNextDoneAfterApply = false;

        const stream = runDraftRefinementLoop({
          skillLegacyName: intent.skill,
          userMessage: userQuery,
          baseArgs: args,
          maxAttempts: DOC_GUARD_MAX_ATTEMPTS,
          runAttempt: (attemptArgs) => {
            const nextIntent = buildIntentFromAgentPlan(skill, attemptArgs, userQuery, docIds);
            if (!nextIntent) {
              throw new Error(`Missing legacy skill mapping for native skill: ${skill.id}`);
            }
            return executeSkillWithStream(run.userId, run.projectKey, nextIntent, traceContext);
          },
          deleteDraft: (draftId) => draftService.delete(draftId),
          traceContext,
        });

        for await (const chunk of stream) {
          if (abortSignal.aborted) {
            run.status = "cancelled";
            run.updatedAt = Date.now();
            traceManager.endSpan(skillSpan, { status: "cancelled" }, "WARNING");
            return;
          }

          // FullAccess: auto-apply drafts without preview (only when validation passed)
          if (chunk.type === "draft" && fullAccess && chunk.draft.validation?.passed === true) {
            try {
              const applyResult = await draftService.apply(run.projectKey, chunk.draft.id);
              const action = applyResult.isNew ? "创建" : "更新";
              const msg = `文档「${chunk.draft.title}」已自动${action}`;
              addDraftToHistory(run.sessionId, chunk.draft);
              yield { type: "done", message: msg };
              skipNextDoneAfterApply = true;
              continue;
            } catch (applyErr) {
              console.warn("[chat] FullAccess auto-apply failed, falling back to draft preview:", applyErr);
              // Fall through to normal draft preview
            }
          }

          if (chunk.type === "done" && skipNextDoneAfterApply) {
            skipNextDoneAfterApply = false;
            continue;
          }

          const mappedChunk = mapSkillChunkToChatChunk(chunk);
          yield mappedChunk;
          if (chunk.type === "draft") {
            addDraftToHistory(run.sessionId, chunk.draft);
          }
        }
      } else {
        for await (const chunk of executeSkillWithStream(run.userId, run.projectKey, intent, traceContext)) {
          if (abortSignal.aborted) {
            run.status = "cancelled";
            run.updatedAt = Date.now();
            traceManager.endSpan(skillSpan, { status: "cancelled" }, "WARNING");
            return;
          }

          // FullAccess: auto-apply drafts without preview
          if (chunk.type === "draft" && fullAccess && (!DOC_GUARD_ENABLED || chunk.draft.validation?.passed === true)) {
            try {
              const applyResult = await draftService.apply(run.projectKey, chunk.draft.id);
              const action = applyResult.isNew ? "创建" : "更新";
              const msg = `文档「${chunk.draft.title}」已自动${action}`;
              addDraftToHistory(run.sessionId, chunk.draft);
              yield { type: "done", message: msg };
              continue;
            } catch (applyErr) {
              console.warn("[chat] FullAccess auto-apply failed, falling back to draft preview:", applyErr);
              // Fall through to normal draft preview
            }
          }

          // Handle organize_plan: fullAccess auto-applies, otherwise ask for confirmation
          if (chunk.type === "organize_plan") {
            if (fullAccess) {
              try {
                const result = await applyOrganizePlan(chunk.plan);
                const msg = `文档整理已自动执行：创建 ${result.created} 个目录，移动 ${result.moved} 篇文档` +
                  (result.errors.length > 0 ? `，${result.errors.length} 个错误` : "");
                yield { type: "done", message: msg };
                continue;
              } catch (applyErr) {
                console.warn("[chat] FullAccess organize auto-apply failed:", applyErr);
              }
            }

            // Non-fullAccess: trigger confirmation via tool_pending
            const pendingTool: PendingToolCall = {
              id: uuidv4(),
              skillName: "doc-organize",
              skillDescription: `整理文档目录结构（${chunk.plan.moves.length} 次移动，${chunk.plan.newFolders.length} 个新目录）`,
              args: { plan_id: chunk.plan.id },
              riskLevel: "high",
              warningMessage: "此操作将重新组织文档目录结构，请确认后执行。",
              createdAt: Date.now(),
              expiresAt: Date.now() + 5 * 60 * 1000,
            };

            run.status = "awaiting_confirmation";
            run.pendingTool = pendingTool;
            run.updatedAt = Date.now();
            yield { type: "tool_pending", pendingTool };

            const confirmed = await waitForConfirmation(run.id);
            run.pendingTool = undefined;

            if (!confirmed || abortSignal.aborted) {
              run.status = "completed";
              run.updatedAt = Date.now();
              yield { type: "tool_rejected", message: "文档整理已取消" };
              return;
            }

            run.status = "running";
            run.updatedAt = Date.now();

            try {
              const result = await applyOrganizePlan(chunk.plan);
              const msg = `文档整理已完成：创建 ${result.created} 个目录，移动 ${result.moved} 篇文档` +
                (result.errors.length > 0 ? `\n⚠️ ${result.errors.length} 个错误：\n${result.errors.join("\n")}` : "");
              yield { type: "done", message: msg };
            } catch (applyErr) {
              yield { type: "error", error: `执行文档整理失败: ${applyErr instanceof Error ? applyErr.message : String(applyErr)}` };
            }
            continue;
          }

          const mappedChunk = mapSkillChunkToChatChunk(chunk);
          yield mappedChunk;
          if (chunk.type === "draft") {
            addDraftToHistory(run.sessionId, chunk.draft);
          }
        }
      }
    } else if (skill.source === "anthropic") {
      let context: string | undefined;
      if (docIds && docIds.length > 0) {
        try {
          const docs = await Promise.all(
            docIds.slice(0, 3).map(async (docId) => {
              const doc = await documentStore.get(run.userId, run.projectKey, docId);
              return `## ${doc.meta.title}\n${JSON.stringify(doc.body)}`;
            }),
          );
          context = docs.join("\n\n---\n\n");
        } catch {
          // Ignore context loading failures
        }
      }

      const userRequest = typeof args.request === "string" && args.request.trim()
        ? args.request
        : userQuery;

      const anthropicSkill = skillRegistry.getAnthropicById(skill.id);
      if (!anthropicSkill) {
        throw new Error(`Anthropic skill not found in registry: ${skill.id}`);
      }

      for await (const chunk of executeAnthropicSkillWithStream(
        run.userId,
        run.projectKey,
        { ...anthropicSkill, enabled: true },
        userRequest,
        context,
        traceContext,
      )) {
        if (abortSignal.aborted) {
          run.status = "cancelled";
          run.updatedAt = Date.now();
          traceManager.endSpan(skillSpan, { status: "cancelled" }, "WARNING");
          return;
        }
        yield mapSkillChunkToChatChunk(chunk);
      }
    } else {
      // MCP tool execution
      const mcpToolId = typeof skill.metadata?.mcpToolId === "string"
        ? skill.metadata.mcpToolId
        : null;
      if (!mcpToolId) {
        throw new Error(`MCP skill metadata missing tool id for ${skill.id}`);
      }

      yield { type: "thinking", content: `正在执行 MCP 工具: ${skill.displayName}...` };
      const result = await mcpClientManager.executeTool(mcpToolId, args);
      if (!result.success) {
        throw new Error(result.error || "MCP tool execution failed");
      }
      if (result.output) {
        yield { type: "delta", content: result.output };
      }
      yield { type: "done", message: `${skill.displayName} 执行完成` };
    }

    run.status = "completed";
    run.updatedAt = Date.now();
    traceManager.endSpan(skillSpan, { status: "completed" });

    // Persist a summary assistant message for skill execution
    persistAssistantMessage(run.sessionId, `[技能执行] ${skill.displayName} 已完成`);
  } catch (err) {
    if (abortSignal.aborted) {
      run.status = "cancelled";
      run.updatedAt = Date.now();
      traceManager.endSpan(skillSpan, { status: "cancelled" }, "WARNING");
      return;
    }
    const errorMessage = err instanceof Error ? err.message : "Agent execution failed";
    run.status = "failed";
    run.updatedAt = Date.now();
    traceManager.endSpan(skillSpan, { error: errorMessage }, "ERROR");
    yield { type: "error", error: errorMessage };
  }
}

/**
 * Create a PendingToolCall from graph's PendingToolInfo for SSE events.
 */
function createPendingToolCallFromGraphInfo(
  info: import("./chat-graph.js").PendingToolInfo,
): PendingToolCall {
  const now = Date.now();
  return {
    id: uuidv4(),
    skillName: info.skillName,
    skillDescription: info.skillDescription,
    args: info.args,
    riskLevel: info.riskLevel as RiskLevel,
    warningMessage: info.warningMessage,
    createdAt: now,
    expiresAt: now + PENDING_TOOL_TTL,
  };
}

function buildIntentFromAgentPlan(
  skill: AgentSkillDefinition,
  args: Record<string, unknown>,
  rawMessage: string,
  docIds?: string[],
): SkillIntent | null {
  const legacySkillName = typeof skill.metadata?.legacySkillName === "string"
    ? skill.metadata.legacySkillName
    : null;
  if (!legacySkillName) {
    return null;
  }

  return {
    skill: legacySkillName,
    command: skill.command || `/${legacySkillName}`,
    args,
    rawMessage,
    docIds,
  };
}

async function* handleAgentExecuteMode(
  run: ChatRun,
  plan: Extract<AgentPlan, { mode: "execute" }>,
  userQuery: string,
  abortSignal: AbortSignal,
  traceContext: TraceContext,
): AsyncGenerator<ChatStreamChunk> {
  const skill = plan.skill;
  const policyCheck = agentPolicyEngine.canUseSkill(skill);
  if (!policyCheck.allowed) {
    run.status = "failed";
    run.updatedAt = Date.now();
    yield { type: "error", error: policyCheck.reason || "Skill blocked by policy" };
    return;
  }

  // Confirmation for medium/high risk skills
  if (agentPolicyEngine.shouldRequireConfirmation(skill)) {
    const pendingTool = createPendingToolCallForAgent(skill, plan.args);
    run.status = "awaiting_confirmation";
    run.pendingTool = pendingTool;
    run.updatedAt = Date.now();
    yield { type: "tool_pending", pendingTool };

    const confirmed = await waitForConfirmation(run.id);
    if (!confirmed) {
      run.pendingTool = undefined;
      run.status = "completed";
      run.updatedAt = Date.now();
      yield { type: "tool_rejected", message: "操作已取消" };
      return;
    }

    run.pendingTool = undefined;
    run.status = "running";
    run.updatedAt = Date.now();
  }

  const skillSpan = traceManager.startSpan(traceContext, `agent:${skill.id}`, {
    source: skill.source,
    toolName: skill.toolName,
    args: plan.args,
    sourceIntent: plan.sourceIntent,
  });

  try {
    if (skill.source === "native") {
      const intent = buildIntentFromAgentPlan(skill, plan.args, userQuery, plan.docIds);
      if (!intent) {
        throw new Error(`Missing legacy skill mapping for native skill: ${skill.id}`);
      }

      for await (const chunk of executeSkillWithStream(run.userId, run.projectKey, intent, traceContext)) {
        if (abortSignal.aborted) {
          run.status = "cancelled";
          run.updatedAt = Date.now();
          traceManager.endSpan(skillSpan, { status: "cancelled" }, "WARNING");
          return;
        }
        const mappedChunk = mapSkillChunkToChatChunk(chunk);
        yield mappedChunk;
        if (chunk.type === "draft") {
          addDraftToHistory(run.sessionId, chunk.draft);
        }
      }
    } else if (skill.source === "anthropic") {
      let context: string | undefined;
      if (plan.docIds && plan.docIds.length > 0) {
        try {
          const docs = await Promise.all(
            plan.docIds.slice(0, 3).map(async (docId) => {
              const doc = await documentStore.get(run.userId, run.projectKey, docId);
              return `## ${doc.meta.title}\n${JSON.stringify(doc.body)}`;
            }),
          );
          context = docs.join("\n\n---\n\n");
        } catch {
          // Ignore context loading failures
        }
      }

      const userRequest = typeof plan.args.request === "string" && plan.args.request.trim()
        ? plan.args.request
        : userQuery;

      const anthropicSkill = skillRegistry.getAnthropicById(skill.id);
      if (!anthropicSkill) {
        throw new Error(`Anthropic skill not found in registry: ${skill.id}`);
      }

      for await (const chunk of executeAnthropicSkillWithStream(
        run.userId,
        run.projectKey,
        { ...anthropicSkill, enabled: true },
        userRequest,
        context,
        traceContext,
      )) {
        if (abortSignal.aborted) {
          run.status = "cancelled";
          run.updatedAt = Date.now();
          traceManager.endSpan(skillSpan, { status: "cancelled" }, "WARNING");
          return;
        }
        yield mapSkillChunkToChatChunk(chunk);
      }
    } else {
      const mcpToolId = typeof skill.metadata?.mcpToolId === "string"
        ? skill.metadata.mcpToolId
        : null;
      if (!mcpToolId) {
        throw new Error(`MCP skill metadata missing tool id for ${skill.id}`);
      }

      yield { type: "thinking", content: `正在执行 MCP 工具: ${skill.displayName}...` };
      const result = await mcpClientManager.executeTool(mcpToolId, plan.args);
      if (!result.success) {
        throw new Error(result.error || "MCP tool execution failed");
      }
      if (result.output) {
        yield { type: "delta", content: result.output };
      }
      yield { type: "done", message: `${skill.displayName} 执行完成` };
    }

    run.status = "completed";
    run.updatedAt = Date.now();
    traceManager.endSpan(skillSpan, { status: "completed" });
  } catch (err) {
    if (abortSignal.aborted) {
      run.status = "cancelled";
      run.updatedAt = Date.now();
      traceManager.endSpan(skillSpan, { status: "cancelled" }, "WARNING");
      return;
    }
    const errorMessage = err instanceof Error ? err.message : "Agent execution failed";
    run.status = "failed";
    run.updatedAt = Date.now();
    traceManager.endSpan(skillSpan, { error: errorMessage }, "ERROR");
    yield { type: "error", error: errorMessage };
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
    for await (const chunk of executeSkillWithStream(run.userId, run.projectKey, trigger.intent, traceContext)) {
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
            const doc = await documentStore.get(run.userId, run.projectKey, docId);
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
      run.userId,
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
      for await (const chunk of executeSkillWithStream(run.userId, run.projectKey, intent, traceContext)) {
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
        run.userId,
        run.projectKey,
        {
          text: userQuery,
          mode: "hybrid",
          limit: 5,
          doc_ids: run.docIds,
        },
      );

      if (searchResults.length > 0) {
        const contextData = await buildContextFromResults(run.userId, run.projectKey, searchResults);
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
      run.userId,
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
    case "organize_plan":
      // organize_plan is handled inline by executeSkillDirect; if it
      // reaches mapSkillChunkToChatChunk, treat it as a noop done.
      return { type: "done", message: "文档整理方案已生成" };
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
  userId: string,
  projectKey: string,
  results: SearchResult[],
): Promise<{ text: string; sources: SourceReference[] }> {
  const sources: SourceReference[] = [];
  const contextParts: string[] = [];

  for (const result of results) {
    let title = result.metadata?.title || "";
    if (!title) {
      try {
        const doc = await documentStore.get(userId, projectKey, result.doc_id);
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
/**
 * Persist an assistant message to the database (fire-and-forget).
 * Also triggers session timestamp update and title generation for the first exchange.
 */
function persistAssistantMessage(
  sessionId: string,
  content: string,
  sources?: unknown,
  artifacts?: unknown,
): void {
  if (!content) return;
  chatSessionStore
    .addMessage(sessionId, "assistant", content, sources || undefined, artifacts || undefined)
    .then(() => chatSessionStore.updateSessionTimestamp(sessionId))
    .then(() => chatSessionStore.getMessageCount(sessionId))
    .then((count) => {
      // Trigger title generation after the first user+assistant exchange (count == 2)
      if (count <= 2) {
        const history = sessionMessages.get(sessionId);
        const firstUserMsg = history?.find((m) => m.role === "user");
        if (firstUserMsg) {
          chatSessionStore.generateTitle(sessionId, firstUserMsg.content);
        }
      }
    })
    .catch((err) => {
      console.warn("[chat] Failed to persist assistant message:", err);
    });
}

export function clearSession(sessionId: string): void {
  sessionMessages.delete(sessionId);
}

/**
 * Get session message count
 */
export function getSessionMessageCount(sessionId: string): number {
  return sessionMessages.get(sessionId)?.length ?? 0;
}
