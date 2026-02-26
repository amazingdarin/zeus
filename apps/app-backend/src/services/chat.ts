import { v4 as uuidv4 } from "uuid";
import { configStore, llmGateway, type ProviderConfigInternal } from "../llm/index.js";
import { documentStore } from "../storage/document-store.js";
import {
  executeSkillWithStream,
  executeAnthropicSkillWithStream,
  skillRegistry,
  type SkillStreamChunk,
  type DocumentDraft,
  type OrganizePlan,
  type SkillIntent,
  type PendingToolCall,
  type RiskLevel,
} from "../llm/skills/index.js";
import { applyOrganizePlan } from "./organize.js";
import { runDraftRefinementLoop } from "../llm/skills/refinement-loop.js";
import {
  agentSkillCatalog,
  mcpClientManager,
  normalizeAndValidateSkillArgs,
  type AgentSkillDefinition,
} from "../llm/agent/index.js";
import { executeDeepSearch, type DeepSearchChunk, type DeepSearchConfig } from "./deep-search.js";
import { traceManager, type TraceContext } from "../observability/index.js";
import {
  executeChatGraph,
  resumeChatGraph,
  resumeChatGraphWithIntent,
  resumeChatGraphWithPreflightInput,
  resumeChatGraphWithRequiredInput,
  type ChatExecutionPlan,
  type ChatGraphResult,
  type GraphSourceReference,
  type IntentOption,
  type PendingIntentInfo,
  type PendingPreflightInfo,
  type TaskRuntimeHints,
  DEEP_SEARCH_CONTEXT_PLACEHOLDER,
} from "./chat-graph.js";
import { chatSettingsStore } from "./chat-settings-store.js";
import { chatSessionStore } from "./chat-session-store.js";
import { draftService } from "./draft.js";
import { resolveProjectScope } from "../project-scope.js";
import { pluginManagerV2 } from "../plugins-v2/index.js";

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
    | "awaiting_input"
    | "awaiting_preflight_input";
  pendingTool?: PendingToolCall;  // Tool awaiting user confirmation
  pendingIntent?: SkillIntent;    // Intent to execute after confirmation
  pendingIntentInfo?: import("./chat-graph.js").PendingIntentInfo;  // Intent clarification
  pendingPreflightInfo?: import("./chat-graph.js").PendingPreflightInfo;
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
    | "preflight_pending"
    | "input_pending"
    | "task_status"
    | "search_start"
    | "search_result";
  content?: string;
  message?: string;
  error?: string;
  sources?: SourceReference[];
  draft?: DocumentDraft;
  pendingTool?: PendingToolCall;  // For tool_pending type
  pendingIntent?: import("./chat-graph.js").PendingIntentInfo;  // For intent_pending type
  pendingPreflight?: import("./chat-graph.js").PendingPreflightInfo;  // For preflight_pending type
  pendingInput?: import("./chat-graph.js").PendingRequiredInputInfo;  // For input_pending type
  taskStatus?: ChatBatchTaskStatus; // For task_status type
  // Deep search specific fields
  phase?: "decompose" | "search_kb" | "evaluate" | "search_web" | "synthesize";
  subQueries?: string[];
  searchQuery?: string;
  resultCount?: number;
};

export type ChatBatchTaskStatus = {
  taskId: string;
  title: string;
  skillId: string;
  index: number;
  total: number;
  failurePolicy: "required" | "best_effort";
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  message?: string;
  error?: string;
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
  resolve: (payload: Record<string, unknown> | null) => void;
  timeout: ReturnType<typeof setTimeout>;
}>();

// Pending preflight input collection
const pendingPreflightInputs = new Map<string, {
  resolve: (payload: Record<string, unknown> | null) => void;
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
const THINKING_TRACE_ENABLED = parseEnvBool("CHAT_THINKING_TRACE_ENABLED", true);
const DEEP_SEARCH_CONTEXT_MAX_CHARS = parseEnvInt("CHAT_DEEP_SEARCH_CONTEXT_MAX_CHARS", 12000);

function intentLabel(type: "command" | "skill" | "deep_search" | "chat"): string {
  switch (type) {
    case "command":
      return "命令执行";
    case "skill":
      return "技能执行";
    case "deep_search":
      return "深度搜索";
    case "chat":
    default:
      return "对话问答";
  }
}

function planThinkingMessage(plan: ChatExecutionPlan): string | null {
  switch (plan.action) {
    case "stream_chat":
      return "已完成检索与上下文准备，开始生成回答。";
    case "execute_skill":
      return `开始执行技能：${plan.skillId}`;
    case "execute_skill_batch":
      return `开始按顺序执行 ${plan.tasks.length} 个子任务。`;
    case "deep_search_then_skill_batch":
      return `先执行深度搜索，再执行 ${plan.tasks.length} 个子任务。`;
    case "deep_search":
      return "进入深度搜索流程。";
    case "respond_text":
      return "已生成直接文本回复。";
    case "respond_blocked":
      return "该请求被策略拦截。";
    case "respond_rejected":
      return "操作被取消。";
    case "respond_error":
      return "执行阶段发生错误。";
    default:
      return null;
  }
}

type BatchTask = Extract<
  ChatExecutionPlan,
  { action: "execute_skill_batch" } | { action: "deep_search_then_skill_batch" }
>['tasks'][number];

function formatBatchTaskStatusLine(status: ChatBatchTaskStatus): string {
  const prefix = `${status.index}/${status.total}. ${status.title}`;
  switch (status.status) {
    case "pending":
      return `${prefix} [pending] ${status.message || "待执行"}`;
    case "completed":
      return `${prefix} [completed] ${status.message || "已完成"}`;
    case "running":
      return `${prefix} [running] ${status.message || "执行中"}`;
    case "skipped":
      return `${prefix} [skipped] ${status.error || status.message || "已跳过"}`;
    case "failed":
    default:
      return `${prefix} [failed] ${status.error || status.message || "执行失败"}`;
  }
}

function resolveBatchTaskInputs(
  task: BatchTask,
  outputContext: Map<string, Record<string, unknown>>,
): {
  args: Record<string, unknown>;
  docIds: string[];
  unresolvedBindings: string[];
  bindingNotes: string[];
} {
  const args = { ...(task.args || {}) };
  let docIds = [...(task.docIds || [])];
  const unresolvedBindings: string[] = [];
  const bindingNotes: string[] = [];

  for (const binding of task.inputBindings || []) {
    const upstreamOutput = outputContext.get(binding.fromTaskId);
    if (!upstreamOutput) {
      unresolvedBindings.push(`${binding.fromTaskId}.${binding.fromKey}`);
      continue;
    }

    const value = upstreamOutput[binding.fromKey];
    if (value === undefined || value === null || (typeof value === "string" && value.trim().length === 0)) {
      unresolvedBindings.push(`${binding.fromTaskId}.${binding.fromKey}`);
      continue;
    }

    if (binding.toArg === "source_doc_ids") {
      const sourceDocIds = Array.isArray(value)
        ? value.map((item) => String(item || "").trim()).filter(Boolean)
        : [String(value).trim()].filter(Boolean);

      if (sourceDocIds.length === 0) {
        unresolvedBindings.push(`${binding.fromTaskId}.${binding.fromKey}`);
        continue;
      }

      args[binding.toArg] = sourceDocIds;
      bindingNotes.push(`${binding.toArg} <- ${binding.fromTaskId}.${binding.fromKey}`);
      continue;
    }

    args[binding.toArg] = value;
    bindingNotes.push(`${binding.toArg} <- ${binding.fromTaskId}.${binding.fromKey}`);

    if (binding.toArg === "doc_id" && typeof value === "string" && value.trim().length > 0) {
      docIds = [value.trim()];
    }
  }

  const argDocId = typeof args.doc_id === "string" ? args.doc_id.trim() : "";
  if (argDocId) {
    docIds = [argDocId];
  }

  return {
    args,
    docIds,
    unresolvedBindings,
    bindingNotes,
  };
}

function parseOutputFromDoneMessage(message?: string): Record<string, unknown> {
  if (!message) return {};

  const output: Record<string, unknown> = {};

  const taskIdMatch = message.match(/task[_\s-]?id\s*[:：=]\s*([a-zA-Z0-9_-]+)/i);
  if (taskIdMatch?.[1]) {
    output.taskId = taskIdMatch[1];
  }

  const docIdMatch = message.match(/doc[_\s-]?id\s*[:：=]\s*([a-zA-Z0-9_-]+)/i);
  if (docIdMatch?.[1]) {
    output.docId = docIdMatch[1];
  }

  return output;
}

function truncateByChars(input: string, maxChars: number): { text: string; truncated: boolean } {
  if (!input || maxChars <= 0) {
    return { text: "", truncated: input.length > 0 };
  }
  if (input.length <= maxChars) {
    return { text: input, truncated: false };
  }
  return {
    text: input.slice(0, maxChars),
    truncated: true,
  };
}

function buildDeepSearchTaskContext(
  userQuery: string,
  deepSearchMessage: string,
  sources: SourceReference[] | undefined,
): string {
  const normalizedMessage = deepSearchMessage.trim();
  const { text: clippedMessage, truncated } = truncateByChars(normalizedMessage, DEEP_SEARCH_CONTEXT_MAX_CHARS);
  const sourceLines = Array.isArray(sources)
    ? sources
      .slice(0, 10)
      .map((source, index) => {
        if (source.type === "web") {
          const url = source.url ? ` (${source.url})` : "";
          return `${index + 1}. ${source.title}${url}`;
        }
        const docId = source.docId ? ` (doc:${source.docId})` : "";
        return `${index + 1}. ${source.title}${docId}`;
      })
    : [];

  const sections: string[] = [
    `用户任务：${userQuery.trim()}`,
    "",
    "以下是深度搜索结果，请据此产出结构化文档（含关键信息、时间点、数据与结论）：",
    clippedMessage || "（深度搜索未返回有效文本）",
  ];

  if (truncated) {
    sections.push("", `注：深度搜索结果过长，已截断到前 ${DEEP_SEARCH_CONTEXT_MAX_CHARS} 字符。`);
  }

  if (sourceLines.length > 0) {
    sections.push("", "参考来源：", ...sourceLines);
  }

  return sections.join("\n");
}

function injectDeepSearchContextValue(value: unknown, context: string): unknown {
  if (typeof value === "string") {
    if (!value.includes(DEEP_SEARCH_CONTEXT_PLACEHOLDER)) return value;
    return value.split(DEEP_SEARCH_CONTEXT_PLACEHOLDER).join(context);
  }

  if (Array.isArray(value)) {
    return value.map((item) => injectDeepSearchContextValue(item, context));
  }

  if (value && typeof value === "object") {
    const replaced: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      replaced[key] = injectDeepSearchContextValue(nested, context);
    }
    return replaced;
  }

  return value;
}

function injectDeepSearchContextTasks(tasks: BatchTask[], context: string): BatchTask[] {
  return tasks.map((task) => ({
    ...task,
    args: injectDeepSearchContextValue(task.args, context) as Record<string, unknown>,
    docIds: [...(task.docIds || [])],
    ...(task.dependsOn ? { dependsOn: [...task.dependsOn] } : {}),
    ...(task.inputBindings ? { inputBindings: task.inputBindings.map((binding) => ({ ...binding })) } : {}),
    ...(task.runtimeHints ? { runtimeHints: { ...task.runtimeHints } } : {}),
  }));
}

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
    const existing = await chatSessionStore.getSession(userId, projectKey, sessionId);
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
      const dbMessages = await chatSessionStore.getMessages(userId, projectKey, sessionId);
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
    .then(() => chatSessionStore.updateSessionTimestamp(userId, projectKey, sessionId))
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
    const scope = resolveProjectScope(userId, projectKey);

    // Use INSERT ... ON CONFLICT to avoid race conditions
    await import("../db/postgres.js").then(({ query }) =>
      query(
        `INSERT INTO chat_sessions (id, user_id, owner_type, owner_id, project_key, title, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, now(), now())
         ON CONFLICT (id) DO NOTHING`,
        [sessionId, userId, scope.ownerType, scope.ownerId, scope.projectKey, "新对话"],
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
    && run.status !== "awaiting_preflight_input"
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

  // If waiting for preflight input, resolve as timeout (null).
  const pendingPreflight = pendingPreflightInputs.get(runId);
  if (pendingPreflight) {
    clearTimeout(pendingPreflight.timeout);
    pendingPreflight.resolve(null);
    pendingPreflightInputs.delete(runId);
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
async function waitForRequiredInput(runId: string): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingRequiredInputs.delete(runId);
      resolve(null);
    }, PENDING_TOOL_TTL);

    pendingRequiredInputs.set(runId, { resolve, timeout });
  });
}

/**
 * Wait for user to provide preflight inputs for all tasks.
 */
async function waitForPreflightInput(runId: string): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingPreflightInputs.delete(runId);
      resolve(null);
    }, PENDING_TOOL_TTL);

    pendingPreflightInputs.set(runId, { resolve, timeout });
  });
}

/**
 * Provide required input for a pending input clarification
 */
export function provideRequiredInput(runId: string, payload: Record<string, unknown>): boolean {
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
 * Provide preflight input payload for pending preflight clarification.
 */
export function providePreflightInput(runId: string, payload: Record<string, unknown>): boolean {
  const run = activeRuns.get(runId);
  if (!run || run.status !== "awaiting_preflight_input") {
    return false;
  }

  const pending = pendingPreflightInputs.get(runId);
  if (pending) {
    clearTimeout(pending.timeout);
    pending.resolve(payload);
    pendingPreflightInputs.delete(runId);
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

export type ProvidePreflightInputPayload = {
  taskInputs: Array<{
    taskId: string;
    doc_id?: string;
    args?: Record<string, unknown>;
  }>;
};
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
      try {
        await agentSkillCatalog.refreshPluginSkillsForUser(run.userId);
      } catch (pluginErr) {
        console.warn("[chat] Failed to refresh plugin skills:", pluginErr);
      }
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

    if (THINKING_TRACE_ENABLED) {
      const reasoning = graphResult.intent.reasoning
        ? `；判断依据：${graphResult.intent.reasoning}`
        : "";
      yield {
        type: "thinking",
        content: `意图识别：${intentLabel(graphResult.intent.type)}（置信度 ${(graphResult.intent.confidence * 100).toFixed(0)}%）${reasoning}`,
      };
    }

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
        if (THINKING_TRACE_ENABLED) {
          yield {
            type: "thinking",
            content: `意图存在歧义，等待你从 ${graphResult.pendingIntent.options.length} 个候选中选择。`,
          };
        }

        traceManager.endSpan(planSpan, {
          intent: graphResult.intent.type,
          planAction: "awaiting_intent",
          candidates: graphResult.pendingIntent.options.length,
        });

        const awaitSpan = traceManager.startSpan(traceContext, "graph.await_intent", {
          intent: graphResult.intent.type,
          candidates: graphResult.pendingIntent.options.length,
        });

        run.status = "awaiting_intent";
        run.pendingIntentInfo = graphResult.pendingIntent;
        run.updatedAt = Date.now();
        yield { type: "intent_pending", pendingIntent: graphResult.pendingIntent };

        // Wait for user to select an intent option
        const selected = await waitForIntentSelection(runId);

        run.pendingIntentInfo = undefined;

        const awaitOutput: Record<string, unknown> = {
          selected: Boolean(selected),
          selectedType: selected?.type,
          selectedLabel: selected?.label,
          status: selected ? "selected" : "timeout",
        };

        if (abortSignal.aborted) {
          traceManager.endSpan(awaitSpan, { ...awaitOutput, status: "cancelled" }, "WARNING");
          run.status = "cancelled";
          run.updatedAt = Date.now();
          return;
        }

        traceManager.endSpan(awaitSpan, awaitOutput, selected ? undefined : "WARNING");

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
        if (THINKING_TRACE_ENABLED) {
          yield {
            type: "thinking",
            content: `执行前缺少必要输入：${graphResult.pendingInput.skillName}（${graphResult.pendingInput.kind}）。`,
          };
        }

        traceManager.endSpan(planSpan, {
          intent: graphResult.intent.type,
          planAction: "awaiting_input",
          kind: graphResult.pendingInput.kind,
          skill: graphResult.pendingInput.skillName,
        });

        const awaitSpan = traceManager.startSpan(traceContext, "graph.await_input", {
          kind: graphResult.pendingInput.kind,
          skill: graphResult.pendingInput.skillName,
          fields: graphResult.pendingInput.kind === "skill_args"
            ? (graphResult.pendingInput.fields?.length || 0)
            : undefined,
          missing: graphResult.pendingInput.kind === "skill_args"
            ? (graphResult.pendingInput.missing?.length || 0)
            : undefined,
        });

        run.status = "awaiting_input";
        run.pendingRequiredInput = graphResult.pendingInput;
        run.updatedAt = Date.now();
        yield { type: "input_pending", pendingInput: graphResult.pendingInput };

        const provided = await waitForRequiredInput(runId);
        run.pendingRequiredInput = undefined;

        const providedArgs = (provided && typeof provided.args === "object" && !Array.isArray(provided.args))
          ? (provided.args as Record<string, unknown>)
          : null;
        const providedDocId = typeof provided?.doc_id === "string" ? provided.doc_id.trim() : "";
        const awaitOutput: Record<string, unknown> = {
          provided: Boolean(provided),
          hasDocId: providedDocId.length > 0,
          argsKeys: providedArgs ? Object.keys(providedArgs).length : 0,
          status: provided ? "provided" : "timeout",
        };

        if (abortSignal.aborted) {
          traceManager.endSpan(awaitSpan, { ...awaitOutput, status: "cancelled" }, "WARNING");
          run.status = "cancelled";
          run.updatedAt = Date.now();
          return;
        }

        traceManager.endSpan(awaitSpan, awaitOutput, provided ? undefined : "WARNING");

        const payload: Record<string, unknown> =
          provided
          || (graphResult.pendingInput.kind === "doc_scope"
            ? { doc_id: "" }
            : { args: {} });

        run.status = "running";
        run.updatedAt = Date.now();

        planSpan = traceManager.startSpan(traceContext, "chat-graph-plan-resume-input", {
          kind: graphResult.pendingInput.kind,
          skill: graphResult.pendingInput.skillName,
          doc_id:
            typeof (payload as { doc_id?: unknown }).doc_id === "string"
              ? (payload as { doc_id?: string }).doc_id
              : undefined,
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

      if (graphResult.status === "awaiting_preflight_input") {
        if (THINKING_TRACE_ENABLED) {
          yield {
            type: "thinking",
            content: `任务编排完成，待补充 ${graphResult.pendingPreflight.missingInputs.length} 项信息后继续。`,
          };
        }

        traceManager.endSpan(planSpan, {
          intent: graphResult.intent.type,
          planAction: "awaiting_preflight_input",
          tasks: graphResult.pendingPreflight.tasks.length,
          missingInputs: graphResult.pendingPreflight.missingInputs.length,
        });

        const awaitSpan = traceManager.startSpan(traceContext, "graph.await_preflight_input", {
          tasks: graphResult.pendingPreflight.tasks.length,
          missingInputs: graphResult.pendingPreflight.missingInputs.length,
        });

        run.status = "awaiting_preflight_input";
        run.pendingPreflightInfo = graphResult.pendingPreflight;
        run.updatedAt = Date.now();
        yield { type: "preflight_pending", pendingPreflight: graphResult.pendingPreflight };

        const provided = await waitForPreflightInput(runId);
        run.pendingPreflightInfo = undefined;

        const taskInputs = provided && Array.isArray((provided as { taskInputs?: unknown }).taskInputs)
          ? ((provided as { taskInputs?: unknown[] }).taskInputs?.length || 0)
          : 0;
        const awaitOutput: Record<string, unknown> = {
          provided: Boolean(provided),
          taskInputs,
          status: provided ? "provided" : "timeout",
        };

        if (abortSignal.aborted) {
          traceManager.endSpan(awaitSpan, { ...awaitOutput, status: "cancelled" }, "WARNING");
          run.status = "cancelled";
          run.updatedAt = Date.now();
          return;
        }

        traceManager.endSpan(awaitSpan, awaitOutput, provided ? undefined : "WARNING");

        const payload: Record<string, unknown> = provided || { taskInputs: [] };

        run.status = "running";
        run.updatedAt = Date.now();

        planSpan = traceManager.startSpan(traceContext, "chat-graph-plan-resume-preflight", {
          hasPayload: !!provided,
          taskInputs: Array.isArray((payload as { taskInputs?: unknown }).taskInputs)
            ? ((payload as { taskInputs?: unknown[] }).taskInputs?.length || 0)
            : 0,
        });

        try {
          graphResult = await resumeChatGraphWithPreflightInput(runId, payload);
        } catch (resumeErr) {
          const errMsg = resumeErr instanceof Error ? resumeErr.message : "Graph resume failed";
          console.error("[chat] Graph resume (preflight) error:", errMsg);
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
        if (THINKING_TRACE_ENABLED) {
          yield {
            type: "thinking",
            content: `该操作风险较高，等待确认：${graphResult.pendingTool.skillName}`,
          };
        }

        traceManager.endSpan(planSpan, {
          intent: graphResult.intent.type,
          planAction: "awaiting_confirmation",
          skill: graphResult.pendingTool.skillName,
        });

        // Build a PendingToolCall for the SSE event
        const pendingTool = createPendingToolCallFromGraphInfo(graphResult.pendingTool);
        const taskCount = Array.isArray((pendingTool.args as { tasks?: unknown }).tasks)
          ? ((pendingTool.args as { tasks?: unknown[] }).tasks?.length || 0)
          : 0;
        const awaitSpan = traceManager.startSpan(traceContext, "graph.await_confirmation", {
          skill: pendingTool.skillName,
          riskLevel: pendingTool.riskLevel,
          taskCount,
        });
        run.status = "awaiting_confirmation";
        run.pendingTool = pendingTool;
        run.updatedAt = Date.now();
        yield { type: "tool_pending", pendingTool };

        // Wait for user confirmation (via confirmTool / rejectTool endpoints)
        const confirmed = await waitForConfirmation(runId);

        run.pendingTool = undefined;

        const awaitOutput: Record<string, unknown> = {
          confirmed,
          status: confirmed ? "confirmed" : "rejected_or_timeout",
        };

        if (abortSignal.aborted) {
          traceManager.endSpan(awaitSpan, { ...awaitOutput, status: "cancelled" }, "WARNING");
          run.status = "cancelled";
          run.updatedAt = Date.now();
          return;
        }

        traceManager.endSpan(awaitSpan, awaitOutput, confirmed ? undefined : "WARNING");

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

    if (THINKING_TRACE_ENABLED) {
      const planMessage = planThinkingMessage(plan);
      if (planMessage) {
        yield { type: "thinking", content: planMessage };
      }
    }

    switch (plan.action) {
      case "stream_chat":
        yield* executeStreamChat(run, plan, abortSignal, traceContext);
        return;

      case "execute_skill":
        yield* executeSkillPlan(run, plan, userQuery, abortSignal, traceContext, chatSettings.fullAccess);
        return;

      case "execute_skill_batch":
        yield* executeSkillBatchPlan(run, plan, userQuery, abortSignal, traceContext, chatSettings.fullAccess);
        return;

      case "deep_search_then_skill_batch":
        yield* executeDeepSearchThenSkillBatchPlan(
          run,
          plan,
          userQuery,
          abortSignal,
          traceContext,
          chatSettings.fullAccess,
        );
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
        persistAssistantMessage(run.userId, run.projectKey, run.sessionId, plan.text);
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
    persistAssistantMessage(run.userId, run.projectKey, run.sessionId, fullResponse, sources);

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
  // Map sourceIntent from graph format to the execution runner format
  const sourceIntent: "command" | "anthropic-keyword" | "tool" =
    plan.sourceIntent === "llm-tool"
      ? "tool"
      : plan.sourceIntent === "keyword"
        ? "anthropic-keyword"
        : "command";

  await agentSkillCatalog.initialize();
  const skill = agentSkillCatalog.getById(plan.skillId, run.userId);
  if (!skill) {
    run.status = "failed";
    run.updatedAt = Date.now();
    yield { type: "error", error: `Unknown skill: ${plan.skillId}` };
    return;
  }

  // Delegate to existing handler, but skip its internal policy check
  // and confirmation logic since the graph already handled those.
  yield* executeSkillDirect(run, skill, plan.args, plan.docIds, sourceIntent, userQuery, abortSignal, traceContext, fullAccess);
}

/**
 * Execute a batch of skill tasks sequentially.
 * Intermediate per-task completion chunks are converted to deltas so SSE stays open.
 */
async function* executeSkillBatchPlan(
  run: ChatRun,
  plan: Extract<ChatExecutionPlan, { action: "execute_skill_batch" }>,
  userQuery: string,
  abortSignal: AbortSignal,
  traceContext: TraceContext,
  fullAccess = false,
): AsyncGenerator<ChatStreamChunk> {
  const taskCount = Array.isArray(plan.tasks) ? plan.tasks.length : 0;
  const taskSummary = Array.isArray(plan.tasks)
    ? plan.tasks.slice(0, 5).map((task, index) => ({
        taskId: task.taskId,
        title: task.title,
        skillId: task.skillId,
        index: index + 1,
        total: taskCount,
        failurePolicy: task.failurePolicy || "required",
      }))
    : [];
  const batchSpan = traceManager.startSpan(traceContext, "skill-batch", {
    taskCount,
    tasks: taskSummary,
  });
  let batchStatus: "completed" | "failed" | "cancelled" | "rejected" | "empty" | "error" = "completed";
  let batchLevel: "DEBUG" | "DEFAULT" | "WARNING" | "ERROR" | undefined;
  let batchError: string | undefined;
  const warnings: string[] = [];

  try {
    if (!Array.isArray(plan.tasks) || plan.tasks.length === 0) {
      batchStatus = "empty";
      run.status = "completed";
      run.updatedAt = Date.now();
      yield { type: "done", message: "没有可执行的任务。" };
      return;
    }

    await agentSkillCatalog.initialize();

    const total = plan.tasks.length;
  const taskOutputContext = new Map<string, Record<string, unknown>>();
  const taskStatusById = new Map<string, ChatBatchTaskStatus>();

  const publishTaskStatus = (status: ChatBatchTaskStatus): ChatStreamChunk => {
    taskStatusById.set(status.taskId, status);
    return {
      type: "task_status",
      taskStatus: status,
    };
  };

  // Publish orchestration result as a TODO-like pending list before execution starts.
  for (let index = 0; index < total; index += 1) {
    const task = plan.tasks[index];
    if (!task) continue;
    yield publishTaskStatus({
      taskId: task.taskId,
      title: task.title,
      skillId: task.skillId,
      index: index + 1,
      total,
      failurePolicy: task.failurePolicy || "required",
      status: "pending",
      message: "待执行",
    });
  }

  for (let index = 0; index < total; index += 1) {
    if (abortSignal.aborted) {
      run.status = "cancelled";
      run.updatedAt = Date.now();
      return;
    }

    const task = plan.tasks[index];
    if (!task) continue;

    const failurePolicy = task.failurePolicy || "required";
    const statusSeed: Omit<ChatBatchTaskStatus, "status" | "message" | "error"> = {
      taskId: task.taskId,
      title: task.title,
      skillId: task.skillId,
      index: index + 1,
      total,
      failurePolicy,
    };

    const unresolvedDependencies = (task.dependsOn || []).filter((taskId) => !taskOutputContext.has(taskId));
    if (unresolvedDependencies.length > 0) {
      const reason = `子任务 ${task.title} 缺少依赖输出: ${unresolvedDependencies.join(", ")}`;
      if (failurePolicy === "best_effort") {
        warnings.push(`${index + 1}. ${task.title}: ${reason}`);
        taskOutputContext.set(task.taskId, {
          taskId: task.taskId,
          skillId: task.skillId,
          status: "failed",
          error: reason,
        });
        yield publishTaskStatus({
          ...statusSeed,
          status: "skipped",
          error: reason,
          message: "依赖缺失，已按 best_effort 跳过",
        });
        yield {
          type: "thinking",
          content: `子任务 ${index + 1}/${total} 失败但已继续（best_effort）：${task.title}`,
        };
        continue;
      }

      yield publishTaskStatus({
        ...statusSeed,
        status: "failed",
        error: reason,
      });
      batchStatus = "failed";
      batchLevel = "ERROR";
      batchError = reason;
      run.status = "failed";
      run.updatedAt = Date.now();
      yield {
        type: "error",
        error: reason,
      };
      return;
    }

    const resolved = resolveBatchTaskInputs(task, taskOutputContext);
    if (resolved.unresolvedBindings.length > 0) {
      const reason = `子任务 ${task.title} 无法解析输入绑定: ${resolved.unresolvedBindings.join(", ")}`;
      if (failurePolicy === "best_effort") {
        warnings.push(`${index + 1}. ${task.title}: ${reason}`);
        taskOutputContext.set(task.taskId, {
          taskId: task.taskId,
          skillId: task.skillId,
          status: "failed",
          error: reason,
        });
        yield publishTaskStatus({
          ...statusSeed,
          status: "skipped",
          error: reason,
          message: "输入绑定解析失败，已按 best_effort 跳过",
        });
        yield {
          type: "thinking",
          content: `子任务 ${index + 1}/${total} 失败但已继续（best_effort）：${task.title}`,
        };
        continue;
      }

      yield publishTaskStatus({
        ...statusSeed,
        status: "failed",
        error: reason,
      });
      batchStatus = "failed";
      batchLevel = "ERROR";
      batchError = reason;
      run.status = "failed";
      run.updatedAt = Date.now();
      yield {
        type: "error",
        error: reason,
      };
      return;
    }

    const sourceIntent: "command" | "anthropic-keyword" | "tool" =
      task.sourceIntent === "llm-tool"
        ? "tool"
        : task.sourceIntent === "keyword"
          ? "anthropic-keyword"
          : "command";

    const skill = agentSkillCatalog.getById(task.skillId, run.userId);
    if (!skill) {
      const reason = `Unknown skill: ${task.skillId}`;
      if (failurePolicy === "best_effort") {
        warnings.push(`${index + 1}. ${task.title}: ${reason}`);
        taskOutputContext.set(task.taskId, {
          taskId: task.taskId,
          skillId: task.skillId,
          status: "failed",
          error: reason,
        });
        yield publishTaskStatus({
          ...statusSeed,
          status: "failed",
          error: reason,
        });
        yield {
          type: "thinking",
          content: `子任务 ${index + 1}/${total} 失败但已继续（best_effort）：${task.title}`,
        };
        continue;
      }

      yield publishTaskStatus({
        ...statusSeed,
        status: "failed",
        error: reason,
      });
      batchStatus = "failed";
      batchLevel = "ERROR";
      batchError = reason;
      run.status = "failed";
      run.updatedAt = Date.now();
      yield { type: "error", error: reason };
      return;
    }

    yield publishTaskStatus({
      ...statusSeed,
      status: "running",
      message: "开始执行",
    });
    yield {
      type: "thinking",
      content: `执行子任务 ${index + 1}/${total}: ${task.title}`,
    };

    if (resolved.bindingNotes.length > 0) {
      yield {
        type: "thinking",
        content: `输入绑定已解析：${resolved.bindingNotes.join("，")}`,
      };
    }

    let taskFailed = false;
    let taskErrorMessage: string | null = null;
    let taskDoneMessage: string | null = null;
    const taskOutput: Record<string, unknown> = {
      taskId: task.taskId,
      skillId: task.skillId,
      status: "running",
    };

    const initialDocId = typeof resolved.args.doc_id === "string" ? resolved.args.doc_id.trim() : "";
    if (initialDocId) {
      taskOutput.docId = initialDocId;
    }

    for await (const chunk of executeSkillDirect(
      run,
      skill,
      resolved.args,
      resolved.docIds,
      sourceIntent,
      userQuery,
      abortSignal,
      traceContext,
      fullAccess,
      {
        finalizeRun: false,
        persistSummary: false,
        runtimeHints: task.runtimeHints,
        onOutput: (output) => {
          Object.assign(taskOutput, output);
        },
      },
    )) {
      if (chunk.type === "done") {
        const msg = chunk.message || `${task.title} 已完成`;
        if (!taskDoneMessage) {
          taskDoneMessage = msg;
          yield { type: "delta", content: `\n[${task.title}] ${msg}\n` };
          Object.assign(taskOutput, parseOutputFromDoneMessage(msg));
        }
        continue;
      }

      if (chunk.type === "tool_rejected") {
        yield chunk;
        batchStatus = "rejected";
        batchLevel = "WARNING";
        run.status = "completed";
        run.updatedAt = Date.now();
        return;
      }

      if (chunk.type === "error") {
        taskFailed = true;
        taskErrorMessage = chunk.error || `${task.title} 执行失败`;
        if (failurePolicy !== "best_effort") {
          yield chunk;
        }
        break;
      }

      yield chunk;
    }

    if (taskFailed) {
      const reason = taskErrorMessage || `${task.title} 执行失败`;
      if (failurePolicy === "best_effort") {
        warnings.push(`${index + 1}. ${task.title}: ${reason}`);
        taskOutputContext.set(task.taskId, {
          ...taskOutput,
          status: "failed",
          error: reason,
        });
        yield publishTaskStatus({
          ...statusSeed,
          status: "failed",
          error: reason,
        });
        yield {
          type: "thinking",
          content: `子任务 ${index + 1}/${total} 失败但已继续（best_effort）：${task.title}`,
        };
        continue;
      }

      yield publishTaskStatus({
        ...statusSeed,
        status: "failed",
        error: reason,
      });
      batchStatus = "failed";
      batchLevel = "ERROR";
      batchError = reason;
      run.status = "failed";
      run.updatedAt = Date.now();
      return;
    }

    const summary = taskDoneMessage || `${task.title} 已完成`;

    if (!taskDoneMessage) {
      yield { type: "delta", content: `\n[${task.title}] ${summary}\n` };
    }

    taskOutputContext.set(task.taskId, {
      ...taskOutput,
      status: "completed",
      message: summary,
    });
    yield publishTaskStatus({
      ...statusSeed,
      status: "completed",
      message: summary,
    });
  }

  const orderedTaskStatuses = plan.tasks.map((task, index) => (
    taskStatusById.get(task.taskId) || {
      taskId: task.taskId,
      title: task.title,
      skillId: task.skillId,
      index: index + 1,
      total,
      failurePolicy: task.failurePolicy || "required",
      status: "skipped" as const,
      message: "未执行",
    }
  ));

  const statusMessage = orderedTaskStatuses.length > 0
    ? `子任务状态：\n${orderedTaskStatuses.map(formatBatchTaskStatusLine).join("\n")}`
    : "子任务状态：无";

  const baseMessage = `批量任务执行完成：\n${statusMessage}`;

  const warningMessage = warnings.length > 0
    ? `\n\n告警（best_effort 已继续）：\n${warnings.join("\n")}`
    : "";

  const finalMessage = `${baseMessage}${warningMessage}`;

  const history = sessionMessages.get(run.sessionId);
  if (history) {
    history.push({ role: "assistant", content: finalMessage });
  }

  run.status = "completed";
  run.updatedAt = Date.now();
  persistAssistantMessage(run.userId, run.projectKey, run.sessionId, finalMessage);
  batchStatus = "completed";
  yield { type: "done", message: finalMessage };
  } catch (err) {
    batchStatus = "error";
    batchLevel = "ERROR";
    batchError = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    traceManager.endSpan(batchSpan, {
      status: batchStatus,
      taskCount,
      warnings: warnings.length,
      ...(batchError ? { error: batchError } : {}),
    }, batchLevel);
  }
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
  options?: {
    finalizeRun?: boolean;
    persistSummary?: boolean;
    runtimeHints?: TaskRuntimeHints;
    onOutput?: (output: Record<string, unknown>) => void;
  },
): AsyncGenerator<ChatStreamChunk> {
  const finalizeRun = options?.finalizeRun ?? true;
  const persistSummary = options?.persistSummary ?? true;

  const normalized = normalizeAndValidateSkillArgs(skill, args, docIds);
  if (!normalized.ok) {
    run.status = "failed";
    run.updatedAt = Date.now();
    yield { type: "error", error: normalized.error.message };
    return;
  }

  const normalizedArgs = normalized.args;
  const normalizedDocIds = normalized.docIds;
  const autoApplyDraft = fullAccess || options?.runtimeHints?.autoApplyDraft === true;

  const publishOutput = (output: Record<string, unknown>): void => {
    if (!options?.onOutput) return;
    options.onOutput(output);
  };

  const initialDocId = typeof normalizedArgs.doc_id === "string" ? normalizedArgs.doc_id.trim() : "";
  if (initialDocId) {
    publishOutput({ docId: initialDocId });
  }

  const skillSpan = traceManager.startSpan(traceContext, `agent:${skill.id}`, {
    source: skill.source,
    toolName: skill.toolName,
    args: normalizedArgs,
    docIds: normalizedDocIds,
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
      const intent = buildIntentFromAgentPlan(skill, normalizedArgs, userQuery, normalizedDocIds);
      if (!intent) {
        throw new Error(`Missing legacy skill mapping for native skill: ${skill.id}`);
      }

      const shouldGuard = DOC_GUARD_ENABLED && isDraftProducingLegacySkill(intent.skill);

      if (shouldGuard) {
        let skipNextDoneAfterApply = false;

        const stream = runDraftRefinementLoop({
          skillLegacyName: intent.skill,
          userMessage: userQuery,
          baseArgs: normalizedArgs,
          maxAttempts: DOC_GUARD_MAX_ATTEMPTS,
          runAttempt: (attemptArgs) => {
            const nextIntent = buildIntentFromAgentPlan(skill, attemptArgs, userQuery, normalizedDocIds);
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
          if (chunk.type === "draft") {
            publishOutput({
              draftId: chunk.draft.id,
              draftDocId: chunk.draft.docId,
            });
          }

          if (chunk.type === "draft" && autoApplyDraft && chunk.draft.validation?.passed === true) {
            try {
              const applyResult = await draftService.apply(run.projectKey, chunk.draft.id);
              const action = applyResult.isNew ? "创建" : "更新";
              const msg = `文档「${chunk.draft.title}」已自动${action}`;
              publishOutput({
                docId: applyResult.docId,
                isNew: applyResult.isNew,
                draftId: chunk.draft.id,
              });
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
          if (chunk.type === "done") {
            publishOutput(parseOutputFromDoneMessage(chunk.message));
          }
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
          if (chunk.type === "draft") {
            publishOutput({
              draftId: chunk.draft.id,
              draftDocId: chunk.draft.docId,
            });
          }

          const allowRuntimeAutoApply = options?.runtimeHints?.autoApplyDraft === true;
          if (chunk.type === "draft" && autoApplyDraft && (!DOC_GUARD_ENABLED || allowRuntimeAutoApply || chunk.draft.validation?.passed === true)) {
            try {
              const applyResult = await draftService.apply(run.projectKey, chunk.draft.id);
              const action = applyResult.isNew ? "创建" : "更新";
              const msg = `文档「${chunk.draft.title}」已自动${action}`;
              publishOutput({
                docId: applyResult.docId,
                isNew: applyResult.isNew,
                draftId: chunk.draft.id,
              });
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
          if (chunk.type === "done") {
            publishOutput(parseOutputFromDoneMessage(chunk.message));
          }
          yield mappedChunk;
          if (chunk.type === "draft") {
            addDraftToHistory(run.sessionId, chunk.draft);
          }
        }
      }
    } else if (skill.source === "anthropic") {
      let context: string | undefined;
      if (normalizedDocIds && normalizedDocIds.length > 0) {
        try {
          const docs = await Promise.all(
            normalizedDocIds.slice(0, 3).map(async (docId) => {
              const doc = await documentStore.get(run.userId, run.projectKey, docId);
              return `## ${doc.meta.title}\n${JSON.stringify(doc.body)}`;
            }),
          );
          context = docs.join("\n\n---\n\n");
        } catch {
          // Ignore context loading failures
        }
      }

      const request = typeof normalizedArgs.request === "string"
        ? normalizedArgs.request.trim()
        : "";
      const userRequest = request ? request : userQuery;

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
    } else if (skill.source === "mcp") {
      // MCP tool execution
      const mcpToolId = typeof skill.metadata?.mcpToolId === "string"
        ? skill.metadata.mcpToolId
        : null;
      if (!mcpToolId) {
        throw new Error(`MCP skill metadata missing tool id for ${skill.id}`);
      }

      yield { type: "thinking", content: `正在执行 MCP 工具: ${skill.displayName}...` };
      const result = await mcpClientManager.executeTool(mcpToolId, normalizedArgs);
      if (!result.success) {
        throw new Error(result.error || "MCP tool execution failed");
      }
      if (result.output) {
        yield { type: "delta", content: result.output };
      }
      yield { type: "done", message: `${skill.displayName} 执行完成` };
    } else {
      const pluginId = typeof skill.metadata?.pluginId === "string"
        ? skill.metadata.pluginId
        : "";
      const commandId = typeof skill.metadata?.commandId === "string"
        ? skill.metadata.commandId
        : "";
      const operationId = typeof skill.metadata?.operationId === "string"
        ? skill.metadata.operationId
        : "";
      if (!pluginId || (!commandId && !operationId)) {
        throw new Error(`Plugin skill metadata missing plugin command/operation id for ${skill.id}`);
      }

      yield { type: "thinking", content: `正在执行插件操作: ${skill.displayName}...` };
      const result = commandId
        ? await pluginManagerV2.executeCommand({
          userId: run.userId,
          projectKey: run.projectKey,
          commandId,
          args: normalizedArgs,
          source: "slash",
          traceId: traceContext.traceId,
        })
        : await pluginManagerV2.executeOperation({
          userId: run.userId,
          projectKey: run.projectKey,
          pluginId,
          operationId,
          args: normalizedArgs,
          traceId: traceContext.traceId,
        });
      publishOutput(result);

      const messageFromResult = typeof result.message === "string"
        ? result.message.trim()
        : "";
      const textFromResult = typeof result.text === "string"
        ? result.text.trim()
        : "";
      const message = messageFromResult || textFromResult || `${skill.displayName} 执行完成`;

      if (messageFromResult || textFromResult) {
        yield { type: "delta", content: message };
      }
      yield { type: "done", message };
    }

    if (finalizeRun) {
      run.status = "completed";
      run.updatedAt = Date.now();
    } else {
      run.status = "running";
      run.updatedAt = Date.now();
    }
    traceManager.endSpan(skillSpan, { status: "completed" });

    // Persist a summary assistant message for single skill execution
    if (persistSummary) {
      persistAssistantMessage(run.userId, run.projectKey, run.sessionId, "[技能执行] " + skill.displayName + " 已完成");
    }
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

async function* executeDeepSearchThenSkillBatchPlan(
  run: ChatRun,
  plan: Extract<ChatExecutionPlan, { action: "deep_search_then_skill_batch" }>,
  userQuery: string,
  abortSignal: AbortSignal,
  traceContext: TraceContext,
  fullAccess = false,
): AsyncGenerator<ChatStreamChunk> {
  if (!Array.isArray(plan.tasks) || plan.tasks.length === 0) {
    run.status = "failed";
    run.updatedAt = Date.now();
    yield { type: "error", error: "深度搜索编排未生成可执行子任务" };
    return;
  }

  const deepSearchSpan = traceManager.startSpan(traceContext, "deep-search-orchestrate", {
    query: userQuery,
    docIds: run.docIds,
    taskCount: plan.tasks.length,
  });

  let deepSearchMessage = "";
  let deepSearchSources: SourceReference[] = [];

  try {
    for await (const chunk of executeDeepSearch(
      run.userId,
      run.projectKey,
      userQuery,
      run.docIds,
      undefined,
      abortSignal,
    )) {
      if (abortSignal.aborted) {
        traceManager.endSpan(deepSearchSpan, { status: "cancelled" }, "WARNING");
        run.status = "cancelled";
        run.updatedAt = Date.now();
        return;
      }

      if (chunk.type === "done") {
        deepSearchMessage = chunk.message || "";
        deepSearchSources = chunk.sources || [];
        continue;
      }

      if (chunk.type === "error") {
        const errorMessage = chunk.error || "Deep search failed";
        traceManager.endSpan(deepSearchSpan, { error: errorMessage }, "ERROR");
        run.status = "failed";
        run.updatedAt = Date.now();
        yield { type: "error", error: errorMessage };
        return;
      }

      yield mapDeepSearchChunkToChatChunk(chunk);
    }
  } catch (err) {
    if (abortSignal.aborted) {
      traceManager.endSpan(deepSearchSpan, { status: "cancelled" }, "WARNING");
      run.status = "cancelled";
      run.updatedAt = Date.now();
      return;
    }

    const errorMessage = err instanceof Error ? err.message : "Deep search failed";
    traceManager.endSpan(deepSearchSpan, { error: errorMessage }, "ERROR");
    run.status = "failed";
    run.updatedAt = Date.now();
    yield { type: "error", error: errorMessage };
    return;
  }

  if (!deepSearchMessage.trim()) {
    const errorMessage = "深度搜索未返回可用内容，无法继续生成文档与 PPT";
    traceManager.endSpan(deepSearchSpan, { error: errorMessage }, "ERROR");
    run.status = "failed";
    run.updatedAt = Date.now();
    yield { type: "error", error: errorMessage };
    return;
  }

  traceManager.endSpan(deepSearchSpan, {
    status: "completed",
    outputChars: deepSearchMessage.length,
    sourceCount: deepSearchSources.length,
  });

  const deepSearchContext = buildDeepSearchTaskContext(userQuery, deepSearchMessage, deepSearchSources);
  const preparedTasks = injectDeepSearchContextTasks(plan.tasks, deepSearchContext);
  const downstreamTasks: Extract<ChatExecutionPlan, { action: "execute_skill_batch" }>["tasks"] = preparedTasks.map((task) => ({
    ...task,
    args: { ...(task.args || {}) },
    docIds: [...(task.docIds || [])],
    ...(task.dependsOn ? { dependsOn: [...task.dependsOn] } : {}),
    ...(task.inputBindings ? { inputBindings: task.inputBindings.map((binding) => ({ ...binding })) } : {}),
    ...(task.runtimeHints ? { runtimeHints: { ...task.runtimeHints } } : {}),
  }));

  yield {
    type: "thinking",
    content: `深度搜索完成，开始执行 ${downstreamTasks.length} 个子任务。`,
  };

  yield* executeSkillBatchPlan(
    run,
    {
      action: "execute_skill_batch",
      tasks: downstreamTasks,
    },
    userQuery,
    abortSignal,
    traceContext,
    fullAccess,
  );
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
 * Clear session history
 */
/**
 * Persist an assistant message to the database (fire-and-forget).
 * Also triggers session timestamp update and title generation for the first exchange.
 */
function persistAssistantMessage(
  userId: string,
  projectKey: string,
  sessionId: string,
  content: string,
  sources?: unknown,
  artifacts?: unknown,
): void {
  if (!content) return;
  chatSessionStore
    .addMessage(sessionId, "assistant", content, sources || undefined, artifacts || undefined)
    .then(() => chatSessionStore.updateSessionTimestamp(userId, projectKey, sessionId))
    .then(() => chatSessionStore.getMessageCount(userId, projectKey, sessionId))
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
