/**
 * Chat Conversation Graph (LangGraph)
 *
 * Defines the complete conversation workflow as a LangGraph StateGraph.
 * The graph handles intent detection, routing, skill planning, policy checks,
 * and human-in-the-loop confirmation (via interrupt).
 *
 * Graph topology:
 *   START → detect_intent → (route by intent)
 *     ├── command     → resolve_command ─┐
 *     ├── skill       → plan_skill      ─┤
 *     │                                   ├→ check_policy → (route)
 *     │                                   │     ├── blocked         → END
 *     │                                   │     ├── no confirm      → END
 *     │                                   │     └── needs confirm   → await_confirmation → END
 *     ├── deep_search → prepare_deep_search → END
 *     └── chat        → rag_retrieve → build_response → END
 *
 * Streaming execution is handled by chat.ts based on the plan output.
 */

import {
  Annotation,
  END,
  START,
  StateGraph,
  MemorySaver,
  interrupt,
  Command,
} from "@langchain/langgraph";
import { configStore, llmGateway } from "../llm/index.js";
import type { ProviderConfigInternal } from "../llm/index.js";
import {
  agentSkillCatalog,
  agentPolicyEngine,
  projectSkillConfigStore,
  type AgentSkillDefinition,
  type AgentRiskLevel,
} from "../llm/agent/index.js";
import { extractDocIdsFromArgs } from "../llm/skills/trigger.js";
import { ragSearch } from "../knowledge/rag-graph.js";
import { documentStore } from "../storage/document-store.js";
import type { TraceContext } from "../observability/index.js";

// ============================================================================
// Types
// ============================================================================

/** Detected intent from user message */
export type ChatIntent = {
  type: "command" | "skill" | "deep_search" | "chat";
  confidence: number;
  skillHint?: string;
  reasoning?: string;
};

/** Info sent to the caller when the graph interrupts for confirmation */
export type PendingToolInfo = {
  skillName: string;
  skillDescription: string;
  args: Record<string, unknown>;
  riskLevel: AgentRiskLevel;
  warningMessage?: string;
};

/** Source reference for RAG results */
export type GraphSourceReference = {
  type?: "kb" | "web";
  docId?: string;
  blockId?: string;
  url?: string;
  title: string;
  snippet: string;
  score: number;
};

export type ChatGraphAttachment = {
  assetId: string;
  name?: string;
  mimeType?: string;
  size?: number;
  type?: string;
};

/** Final execution plan produced by the graph */
export type ChatExecutionPlan =
  | {
      action: "stream_chat";
      ragContext: string;
      ragSources: GraphSourceReference[];
      systemPrompt: string;
    }
  | {
      action: "execute_skill";
      skill: AgentSkillDefinition;
      args: Record<string, unknown>;
      docIds: string[];
      sourceIntent: "command" | "keyword" | "llm-tool";
    }
  | { action: "deep_search" }
  | { action: "respond_text"; text: string }
  | { action: "respond_blocked"; reason: string }
  | { action: "respond_rejected"; reason: string }
  | { action: "respond_error"; error: string };

/** Result of executing or resuming the chat graph */
export type ChatGraphResult =
  | { status: "complete"; plan: ChatExecutionPlan; intent: ChatIntent }
  | { status: "awaiting_confirmation"; pendingTool: PendingToolInfo; intent: ChatIntent };

// ============================================================================
// Graph State
// ============================================================================

/** Helper: last-value reducer with a default. Required by @langchain/langgraph ^0.2 */
function lv<T>(defaultFn: () => T) {
  return { value: (_prev: T, next: T) => next, default: defaultFn };
}

const ChatGraphState = Annotation.Root({
  // ---- Input (set at invocation) ----
  userQuery: Annotation<string>,
  messages: Annotation<Array<{ role: string; content: string }>>,
  projectKey: Annotation<string>,
  userId: Annotation<string>,
  sessionId: Annotation<string>,
  docIds: Annotation<string[] | undefined>(lv<string[] | undefined>(() => undefined)),
  attachments: Annotation<ChatGraphAttachment[] | undefined>(lv<ChatGraphAttachment[] | undefined>(() => undefined)),
  deepSearchRequested: Annotation<boolean>(lv(() => false)),
  fullAccess: Annotation<boolean>(lv(() => false)),
  traceContext: Annotation<TraceContext | undefined>(lv<TraceContext | undefined>(() => undefined)),

  // ---- Intent detection ----
  intent: Annotation<ChatIntent>(lv<ChatIntent>(() => ({ type: "chat", confidence: 0 }))),

  // ---- Skill resolution ----
  matchedSkill: Annotation<AgentSkillDefinition | null>(lv<AgentSkillDefinition | null>(() => null)),
  skillArgs: Annotation<Record<string, unknown>>(lv<Record<string, unknown>>(() => ({}))),
  skillDocIds: Annotation<string[]>(lv<string[]>(() => [])),
  sourceIntent: Annotation<"command" | "keyword" | "llm-tool">(lv<"command" | "keyword" | "llm-tool">(() => "command")),

  // ---- Policy ----
  needsConfirmation: Annotation<boolean>(lv(() => false)),

  // ---- RAG context ----
  ragContext: Annotation<string>(lv(() => "")),
  ragSources: Annotation<GraphSourceReference[]>(lv<GraphSourceReference[]>(() => [])),

  // ---- LLM config (cached per invocation) ----
  llmConfig: Annotation<ProviderConfigInternal | null>(lv<ProviderConfigInternal | null>(() => null)),

  // ---- Output ----
  plan: Annotation<ChatExecutionPlan>(lv<ChatExecutionPlan>(() => ({ action: "respond_error", error: "No plan generated" }))),
});

type GraphState = typeof ChatGraphState.State;

// ============================================================================
// Constants
// ============================================================================

const COMMAND_REGEX = /^\/([a-z]+-[a-z-]+)(?:\s+(.*))?$/;

// ============================================================================
// Node: detect_intent
// ============================================================================

const INTENT_SYSTEM_PROMPT = `你是 Zeus 文档管理系统的意图分析器。根据用户消息判断其意图类型。

输出严格 JSON 格式（不要包含 markdown 代码块标记）：
{"type":"command|skill|deep_search|chat","confidence":0.0-1.0,"skill_hint":"可选的技能名","reasoning":"简短推理"}

意图分类规则：
- command: 消息以 / 开头的显式斜杠命令
- skill: 用户明确想要执行文档操作（创建文档、编辑文档、删除文档、移动文档、优化文档、导入文档、格式转换等）
- deep_search: 复杂问题，需要多轮检索和综合分析（"详细分析"、"全面调研"、"深入对比"、"系统整理"等）
- chat: 简单提问、知识检索、闲聊、或意图不明确的请求

skill_hint 可选值: doc-create, doc-edit, doc-delete, doc-move, doc-read, doc-summary, doc-optimize-format, doc-optimize-content, doc-optimize-style, doc-optimize-full, kb-search, doc-fetch-url, doc-import-git, doc-smart-import, doc-convert

示例：
用户: "帮我创建一篇关于API设计的文档" → {"type":"skill","confidence":0.95,"skill_hint":"doc-create","reasoning":"用户要求创建文档"}
用户: "这个项目的架构是什么？" → {"type":"chat","confidence":0.9,"reasoning":"用户在提问，不需要执行操作"}
用户: "详细分析一下我们的技术债务情况" → {"type":"deep_search","confidence":0.85,"reasoning":"需要多轮搜索和综合分析"}
用户: "/doc-create 新文档" → {"type":"command","confidence":1.0,"reasoning":"显式斜杠命令"}`;

async function detectIntent(state: GraphState): Promise<Partial<GraphState>> {
  // Fast path 1: Explicit slash command
  if (state.userQuery.trim().match(COMMAND_REGEX)) {
    return {
      intent: { type: "command", confidence: 1.0, reasoning: "Explicit slash command" },
    };
  }

  // Fast path 2: UI deep search toggle
  if (state.deepSearchRequested) {
    return {
      intent: { type: "deep_search", confidence: 1.0, reasoning: "Deep search toggled by user" },
    };
  }

  // Load LLM config for this invocation
  const llmConfig = await configStore.getInternalByType("llm");
  if (!llmConfig?.enabled || !llmConfig.defaultModel) {
    return {
      intent: heuristicIntent(state.userQuery),
      llmConfig,
    };
  }

  // LLM-based intent detection
  try {
    const response = await llmGateway.chat({
      provider: llmConfig.providerId,
      model: llmConfig.defaultModel,
      messages: [
        { role: "system", content: INTENT_SYSTEM_PROMPT },
        { role: "user", content: state.userQuery },
      ],
      temperature: 0,
      maxTokens: 150,
      baseUrl: llmConfig.baseUrl,
      apiKey: llmConfig.apiKey,
      traceContext: state.traceContext,
    });

    const parsed = JSON.parse(response.content.trim()) as {
      type?: string;
      confidence?: number;
      skill_hint?: string;
      reasoning?: string;
    };
    return {
      intent: {
        type: (parsed.type as ChatIntent["type"]) || "chat",
        confidence: parsed.confidence ?? 0.5,
        skillHint: parsed.skill_hint,
        reasoning: parsed.reasoning,
      },
      llmConfig,
    };
  } catch (err) {
    console.warn("[ChatGraph] Intent detection failed, using heuristic:", err);
    return {
      intent: heuristicIntent(state.userQuery),
      llmConfig,
    };
  }
}

/** Heuristic fallback when LLM is unavailable */
function heuristicIntent(message: string): ChatIntent {
  const lower = message.toLowerCase();
  const skillKeywords = [
    "创建文档", "新建文档", "编辑文档", "修改文档", "删除文档",
    "移动文档", "优化文档", "导入", "转换格式", "create doc",
    "edit doc", "delete doc", "move doc",
  ];
  const deepKeywords = [
    "详细分析", "全面调研", "深入了解", "系统整理", "全面分析",
    "深入对比", "综合评估",
  ];

  if (deepKeywords.some((k) => lower.includes(k))) {
    return { type: "deep_search", confidence: 0.7, reasoning: "Keyword match: deep search" };
  }
  if (skillKeywords.some((k) => lower.includes(k))) {
    return { type: "skill", confidence: 0.7, reasoning: "Keyword match: skill" };
  }
  return { type: "chat", confidence: 0.6, reasoning: "Default fallback" };
}

// ============================================================================
// Node: resolve_command
// ============================================================================

async function resolveCommand(state: GraphState): Promise<Partial<GraphState>> {
  const match = state.userQuery.trim().match(COMMAND_REGEX);
  if (!match) {
    return { matchedSkill: null };
  }

  await agentSkillCatalog.initialize();
  const [, commandName, rest = ""] = match;
  const command = `/${commandName}`;
  const skill = agentSkillCatalog.getByCommand(command);

  if (!skill) {
    return { matchedSkill: null };
  }

  // Check if enabled
  const allSkills = agentSkillCatalog.getAllSkills();
  const enabledIds = new Set(
    await projectSkillConfigStore.getEnabledSkillIds(state.projectKey, allSkills),
  );
  if (!enabledIds.has(skill.id)) {
    return {
      matchedSkill: null,
      plan: {
        action: "respond_blocked",
        reason: `技能 ${command} 已被禁用，请在项目设置中启用。`,
      },
    };
  }

  const args = buildCommandArgs(skill, rest.trim(), state.docIds);
  return {
    matchedSkill: skill,
    skillArgs: args,
    skillDocIds: state.docIds || [],
    sourceIntent: "command",
  };
}

// ============================================================================
// Node: plan_skill
// ============================================================================

async function planSkill(state: GraphState): Promise<Partial<GraphState>> {
  await agentSkillCatalog.initialize();
  const allSkills = agentSkillCatalog.getAllSkills();
  const enabledIds = new Set(
    await projectSkillConfigStore.getEnabledSkillIds(state.projectKey, allSkills),
  );

  // Step 1: Try keyword matching (fast, no LLM)
  const keywordMatch = agentSkillCatalog.matchAnthropicByKeywords(
    state.userQuery.trim(),
    enabledIds,
  );
  if (keywordMatch) {
    return {
      matchedSkill: keywordMatch,
      skillArgs: { request: state.userQuery.trim() },
      skillDocIds: state.docIds || [],
      sourceIntent: "keyword",
    };
  }

  // Step 2: Try skill_hint from intent detection
  if (state.intent.skillHint) {
    const hintCommand = `/${state.intent.skillHint}`;
    const hintSkill = agentSkillCatalog.getByCommand(hintCommand);
    if (hintSkill && enabledIds.has(hintSkill.id)) {
      const args = buildCommandArgs(hintSkill, state.userQuery.trim(), state.docIds);
      return {
        matchedSkill: hintSkill,
        skillArgs: args,
        skillDocIds: state.docIds || [],
        sourceIntent: "llm-tool",
      };
    }
  }

  // Step 3: LLM tool selection (if LLM available)
  const config = state.llmConfig;
  if (!config?.enabled || !config.defaultModel) {
    return { matchedSkill: null };
  }

  const tools = agentSkillCatalog.toOpenAITools(enabledIds);
  if (tools.length === 0) {
    return { matchedSkill: null };
  }

  try {
    const systemPrompt = buildToolSelectionPrompt(tools.map((t) => t.function.name));
    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: systemPrompt },
      ...state.messages.map((m) => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
      })),
    ];

    if (state.docIds && state.docIds.length > 0) {
      messages.push({
        role: "system",
        content: `用户关联的文档 ID: ${state.docIds.join(", ")}`,
      });
    }

    if (state.attachments && state.attachments.length > 0) {
      const lines = state.attachments
        .slice(0, 10)
        .map((a) => {
          const name = a.name ? ` name=${a.name}` : "";
          const mime = a.mimeType ? ` mime=${a.mimeType}` : "";
          const size = typeof a.size === "number" ? ` size=${a.size}` : "";
          const type = a.type ? ` type=${a.type}` : "";
          return `- asset_id=${a.assetId}${name}${mime}${size}${type}`;
        })
        .join("\n");
      messages.push({
        role: "system",
        content: `当前可用附件(可用于导入):\n${lines}`,
      });
    }

    const response = await llmGateway.chatWithTools({
      provider: config.providerId,
      model: config.defaultModel,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      messages,
      tools,
      tool_choice: "auto",
      traceContext: state.traceContext,
    });

    if (response.toolCalls && response.toolCalls.length > 0) {
      const firstCall = response.toolCalls[0];
      const skill = agentSkillCatalog.getByToolName(firstCall.function.name);
      if (skill) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(firstCall.function.arguments);
        } catch {
          args = {};
        }
        return {
          matchedSkill: skill,
          skillArgs: args,
          skillDocIds: extractDocIdsFromArgs(args, state.docIds),
          sourceIntent: "llm-tool",
        };
      }
    }

    // LLM chose to respond with text instead of a tool
    if (response.content?.trim()) {
      return {
        matchedSkill: null,
        plan: { action: "respond_text", text: response.content },
      };
    }
  } catch (err) {
    console.warn("[ChatGraph] LLM tool selection failed:", err);
  }

  return { matchedSkill: null };
}

// ============================================================================
// Node: check_policy
// ============================================================================

async function checkPolicy(state: GraphState): Promise<Partial<GraphState>> {
  const skill = state.matchedSkill;
  if (!skill) {
    return {
      plan: { action: "respond_error", error: "No skill resolved in check_policy" },
    };
  }

  const policyResult = agentPolicyEngine.canUseSkill(skill);
  if (!policyResult.allowed) {
    return {
      plan: {
        action: "respond_blocked",
        reason: policyResult.reason || "操作被策略禁止",
      },
    };
  }

  // FullAccess mode: skip confirmation entirely
  const needsConfirm = state.fullAccess
    ? false
    : agentPolicyEngine.shouldRequireConfirmation(skill);

  if (needsConfirm) {
    return {
      needsConfirmation: true,
    };
  }

  // Directly allowed — produce execute_skill plan
  return {
    needsConfirmation: false,
    plan: {
      action: "execute_skill",
      skill,
      args: state.skillArgs,
      docIds: state.skillDocIds,
      sourceIntent: state.sourceIntent,
    },
  };
}

// ============================================================================
// Node: await_confirmation (Human-in-the-Loop via interrupt)
// ============================================================================

async function awaitConfirmation(state: GraphState): Promise<Partial<GraphState>> {
  const skill = state.matchedSkill!;

  // interrupt() pauses graph execution.
  // The interrupt payload is surfaced to the caller via graph state inspection.
  // When the caller resumes with Command({ resume: { confirmed } }),
  // interrupt() returns that value.
  const response = interrupt({
    skillName: skill.displayName,
    skillDescription: skill.description,
    args: state.skillArgs,
    riskLevel: skill.risk.level,
    warningMessage: skill.risk.warningMessage,
  } satisfies PendingToolInfo);

  const confirmed =
    typeof response === "object" && response !== null && "confirmed" in response
      ? !!(response as { confirmed: boolean }).confirmed
      : !!response;

  if (confirmed) {
    return {
      plan: {
        action: "execute_skill",
        skill,
        args: state.skillArgs,
        docIds: state.skillDocIds,
        sourceIntent: state.sourceIntent,
      },
    };
  }

  return {
    plan: { action: "respond_rejected", reason: "操作已取消" },
  };
}

// ============================================================================
// Node: rag_retrieve
// ============================================================================

async function ragRetrieve(state: GraphState): Promise<Partial<GraphState>> {
  if (!state.userQuery.trim()) {
    return { ragContext: "", ragSources: [] };
  }

  try {
    const results = await ragSearch(
      state.userId,
      state.projectKey,
      state.userQuery,
      {
        docIds: state.docIds,
        strategy: "adaptive",
        enableSelfRAG: true,
        enableReranking: true,
        limit: 5,
      },
    );

    if (results.length === 0) {
      return { ragContext: "", ragSources: [] };
    }

    const sources: GraphSourceReference[] = [];
    const contextParts: string[] = [];

    for (const result of results) {
      let title = result.metadata?.title || "";
      if (!title) {
        try {
          const doc = await documentStore.get(state.userId, state.projectKey, result.doc_id);
          title = doc.meta.title || result.doc_id;
        } catch {
          title = result.doc_id;
        }
      }

      sources.push({
        docId: result.doc_id,
        blockId: result.block_id,
        title,
        snippet: result.content.slice(0, 200),
        score: result.score ?? 0,
      });

      contextParts.push(`【${title}】\n${result.content}`);
    }

    return {
      ragContext: contextParts.join("\n\n---\n\n"),
      ragSources: sources,
    };
  } catch (err) {
    console.warn("[ChatGraph] RAG retrieval failed:", err);
    return { ragContext: "", ragSources: [] };
  }
}

// ============================================================================
// Node: build_response
// ============================================================================

async function buildResponse(state: GraphState): Promise<Partial<GraphState>> {
  const systemPrompt = buildChatSystemPrompt(state.projectKey, state.ragContext);
  return {
    plan: {
      action: "stream_chat",
      ragContext: state.ragContext,
      ragSources: state.ragSources,
      systemPrompt,
    },
  };
}

// ============================================================================
// Node: prepare_deep_search
// ============================================================================

async function prepareDeepSearch(
  _state: GraphState,
): Promise<Partial<GraphState>> {
  return {
    plan: { action: "deep_search" },
  };
}

// ============================================================================
// Routing functions
// ============================================================================

function routeAfterIntent(state: GraphState): string {
  switch (state.intent.type) {
    case "command":
      return "resolve_command";
    case "skill":
      return "plan_skill";
    case "deep_search":
      return "prepare_deep_search";
    case "chat":
    default:
      return "rag_retrieve";
  }
}

function routeAfterResolveCommand(state: GraphState): string {
  // If plan already set (e.g. respond_blocked), go to END
  if (state.plan.action === "respond_blocked") return "__end__";
  // If a skill was found, check policy
  if (state.matchedSkill) return "check_policy";
  // No skill found — fallback to chat
  return "rag_retrieve";
}

function routeAfterPlanSkill(state: GraphState): string {
  // If skill matched, check policy
  if (state.matchedSkill) return "check_policy";
  // If plan_skill explicitly produced a text response, go to END
  if (state.plan.action === "respond_text") return "__end__";
  // No skill matched and no explicit plan — fallback to chat (rag)
  return "rag_retrieve";
}

function routeAfterCheckPolicy(state: GraphState): string {
  // If plan already set (blocked or execute_skill), go to END
  if (state.plan.action === "respond_blocked" || state.plan.action === "execute_skill") {
    return "__end__";
  }
  // Needs confirmation
  if (state.needsConfirmation) return "await_confirmation";
  return "__end__";
}

// ============================================================================
// Graph Definition
// ============================================================================

const checkpointer = new MemorySaver();

const chatGraph = new StateGraph(ChatGraphState)
  // Nodes
  .addNode("detect_intent", detectIntent)
  .addNode("resolve_command", resolveCommand)
  .addNode("plan_skill", planSkill)
  .addNode("check_policy", checkPolicy)
  .addNode("await_confirmation", awaitConfirmation)
  .addNode("rag_retrieve", ragRetrieve)
  .addNode("build_response", buildResponse)
  .addNode("prepare_deep_search", prepareDeepSearch)

  // Edges: START → detect_intent
  .addEdge(START, "detect_intent")

  // detect_intent → 4-way routing
  .addConditionalEdges("detect_intent", routeAfterIntent, {
    resolve_command: "resolve_command",
    plan_skill: "plan_skill",
    rag_retrieve: "rag_retrieve",
    prepare_deep_search: "prepare_deep_search",
  })

  // resolve_command → check_policy | rag_retrieve | END
  .addConditionalEdges("resolve_command", routeAfterResolveCommand, {
    check_policy: "check_policy",
    rag_retrieve: "rag_retrieve",
    __end__: END,
  })

  // plan_skill → check_policy | rag_retrieve | END
  .addConditionalEdges("plan_skill", routeAfterPlanSkill, {
    check_policy: "check_policy",
    rag_retrieve: "rag_retrieve",
    __end__: END,
  })

  // check_policy → await_confirmation | END
  .addConditionalEdges("check_policy", routeAfterCheckPolicy, {
    await_confirmation: "await_confirmation",
    __end__: END,
  })

  // await_confirmation → END (always, after confirmed/rejected)
  .addEdge("await_confirmation", END)

  // rag_retrieve → build_response → END
  .addEdge("rag_retrieve", "build_response")
  .addEdge("build_response", END)

  // prepare_deep_search → END
  .addEdge("prepare_deep_search", END)

  .compile({ checkpointer });

// ============================================================================
// Public API
// ============================================================================

export type ChatGraphInput = {
  userQuery: string;
  messages: Array<{ role: string; content: string }>;
  projectKey: string;
  userId: string;
  sessionId: string;
  docIds?: string[];
  attachments?: ChatGraphAttachment[];
  deepSearchRequested?: boolean;
  fullAccess?: boolean;
  traceContext?: TraceContext;
};

/**
 * Execute the chat conversation graph (first invocation).
 * May return "complete" with a plan, or "awaiting_confirmation" if the graph
 * interrupted at the await_confirmation node.
 *
 * @param runId  Unique identifier for the chat run (used as thread_id)
 * @param input  Graph input state
 */
export async function executeChatGraph(
  runId: string,
  input: ChatGraphInput,
): Promise<ChatGraphResult> {
  const config = { configurable: { thread_id: runId } };

  const graphInput = {
    userQuery: input.userQuery,
    messages: input.messages,
    projectKey: input.projectKey,
    userId: input.userId,
    sessionId: input.sessionId,
    docIds: input.docIds,
    attachments: input.attachments,
    deepSearchRequested: input.deepSearchRequested ?? false,
    fullAccess: input.fullAccess ?? false,
    traceContext: input.traceContext,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LangGraph invoke typing requires exact match
  const result = await chatGraph.invoke(graphInput as any, config);

  // Check if the graph is interrupted (awaiting confirmation)
  const snapshot = await chatGraph.getState(config);
  const isInterrupted = snapshot.next && snapshot.next.length > 0;

  if (isInterrupted) {
    // Extract the interrupt payload from the snapshot
    const interruptValue = extractInterruptValue(snapshot);
    return {
      status: "awaiting_confirmation",
      pendingTool: interruptValue || {
        skillName: result.matchedSkill?.displayName || "Unknown",
        skillDescription: result.matchedSkill?.description || "",
        args: result.skillArgs || {},
        riskLevel: result.matchedSkill?.risk?.level || "medium",
      },
      intent: result.intent,
    };
  }

  return {
    status: "complete",
    plan: result.plan,
    intent: result.intent,
  };
}

/**
 * Resume the chat graph after user confirmation/rejection.
 *
 * @param runId     The same runId used in executeChatGraph
 * @param confirmed Whether the user confirmed the operation
 */
export async function resumeChatGraph(
  runId: string,
  confirmed: boolean,
): Promise<ChatGraphResult> {
  const config = { configurable: { thread_id: runId } };

  const result = await chatGraph.invoke(
    new Command({ resume: { confirmed } }),
    config,
  );

  return {
    status: "complete",
    plan: result.plan,
    intent: result.intent,
  };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extract the interrupt value from a graph state snapshot.
 */
function extractInterruptValue(
  snapshot: Awaited<ReturnType<typeof chatGraph.getState>>,
): PendingToolInfo | null {
  try {
    // LangGraph stores interrupt values in snapshot.tasks[].interrupts[].value
    const tasks = (snapshot as unknown as Record<string, unknown>).tasks;
    if (Array.isArray(tasks)) {
      for (const task of tasks) {
        const interrupts = (task as Record<string, unknown>).interrupts;
        if (Array.isArray(interrupts) && interrupts.length > 0) {
          return interrupts[0].value as PendingToolInfo;
        }
      }
    }
  } catch {
    // ignore extraction errors
  }
  return null;
}

/**
 * Build args for a command-style skill invocation.
 * Migrated from orchestrator.ts buildCommandArgs.
 */
function buildCommandArgs(
  skill: AgentSkillDefinition,
  rest: string,
  docIds?: string[],
): Record<string, unknown> {
  const trimmed = rest.trim();
  const firstDocId = docIds && docIds.length > 0 ? docIds[0] : undefined;
  const legacy =
    typeof skill.metadata?.legacySkillName === "string"
      ? skill.metadata.legacySkillName
      : "";

  switch (legacy) {
    case "doc-create":
      return { title: trimmed || "新文档", description: trimmed, parent_id: firstDocId || null };
    case "doc-edit":
      return { instructions: trimmed };
    case "doc-read":
    case "doc-summary":
      return {};
    case "doc-optimize-format":
    case "doc-optimize-content":
    case "doc-optimize-full":
      return trimmed ? { instructions: trimmed } : {};
    case "doc-optimize-style": {
      const [style, ...parts] = trimmed.split(/\s+/).filter(Boolean);
      return {
        style: style || "professional",
        ...(parts.length > 0 ? { instructions: parts.join(" ") } : {}),
      };
    }
    case "doc-delete":
      return { doc_id: firstDocId, recursive: /\brecursive\b|\b递归\b/.test(trimmed) };
    case "doc-move":
      return { doc_id: firstDocId, target_parent_id: trimmed || "root" };
    case "kb-search":
      return { query: trimmed };
    case "doc-fetch-url":
      return { url: trimmed };
    case "doc-import-git":
      return { repo_url: trimmed };
    case "doc-smart-import":
      return { asset_id: trimmed };
    case "doc-convert":
      return { content: trimmed, from: "txt", to: "markdown" };
    default:
      if (skill.source === "anthropic") return { request: trimmed || rest };
      return { input: trimmed };
  }
}

function buildToolSelectionPrompt(toolNames: string[]): string {
  return `你是 Zeus System Agent。根据用户请求选择最匹配的技能。

可用技能: ${toolNames.join(", ")}

规则:
1. 只有在任务明确时才调用技能
2. 参数尽量从用户消息中完整提取
3. 如果没有合适技能，直接回答文本`;
}

function buildChatSystemPrompt(projectKey: string, ragContext: string): string {
  const base = `你是 Zeus 文档管理系统的智能助手。当前项目: ${projectKey}`;

  if (!ragContext) {
    return `${base}

你的职责:
1. 帮助用户管理和编辑文档
2. 回答关于项目内容的问题
3. 提供文档写作建议

请用中文回复，保持简洁专业。`;
  }

  return `${base}

## 相关文档内容
${ragContext}

## 回答要求
1. 优先使用上述文档内容回答
2. 内容不足时可补充通用知识
3. 引用文档时说明来源
4. 中文回答，简洁专业`;
}
