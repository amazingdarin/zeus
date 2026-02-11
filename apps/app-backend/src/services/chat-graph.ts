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
 *     │                                   ├→ orchestrate_tasks → preflight_validate → (route)
 *     │                                   │                                   ├── needs input    → await_preflight_input → preflight_validate (loop)
 *     │                                   │                                   ├── single task    → review_agent → (route)
 *     │                                   │                                   │         ├── no confirm    → END
 *     │                                   │                                   │         └── needs confirm → await_confirmation → END
 *     │                                   │                                   └── multi tasks    → END (execute_skill_batch)
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
  projectSkillConfigStore,
  type AgentRiskLevel,
} from "../llm/agent/index.js";
import type { TraceContext } from "../observability/index.js";
import { buildCommandArgs, runPlannerAgent } from "./agents/planner-agent.js";
import { runRetrievalAgent } from "./agents/retrieval-agent.js";
import { runDocAgent } from "./agents/doc-agent.js";
import { runReviewAgent } from "./agents/review-agent.js";

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

/** A single intent option for clarification */
export type IntentOption = {
  type: ChatIntent["type"];
  skillHint?: string;
  label: string;
  confidence: number;
};

/** Info sent to the caller when the graph interrupts for intent clarification */
export type PendingIntentInfo = {
  message: string;
  options: IntentOption[];
};

/** Info sent to the caller when the graph interrupts for missing required input */
export type PendingRequiredInputInfo =
  | {
      kind: "doc_scope";
      message: string;
      skillName: string;
      skillDescription: string;
    }
  | {
      kind: "skill_args";
      message: string;
      skillName: string;
      skillDescription: string;
      /** Keys that are missing but required (if applicable). */
      missing?: string[];
      /** Zod validation issues (if applicable). */
      issues?: Array<{ path: string; message: string }>;
      /** Fields to collect from the user. */
      fields: Array<{
        key: string;
        type: string;
        description: string;
        enum?: string[];
      }>;
      /** Optional: current args snapshot for UI defaults. */
      currentArgs?: Record<string, unknown>;
    };

export type PreflightTaskInfo = {
  taskId: string;
  title: string;
  subagentId: string;
  subagentName: string;
  status: "ready" | "missing_input" | "blocked" | "waiting_dependency";
  reason?: string;
};

export type PreflightMissingInput = {
  taskId: string;
  kind: "doc_scope" | "skill_args";
  skillName: string;
  message: string;
  fields?: Array<{
    key: string;
    type: string;
    description: string;
    enum?: string[];
  }>;
  missing?: string[];
  issues?: Array<{ path: string; message: string }>;
  currentArgs?: Record<string, unknown>;
};

export type PendingPreflightInfo = {
  message: string;
  tasks: PreflightTaskInfo[];
  missingInputs: PreflightMissingInput[];
};

export type TaskInputBinding = {
  fromTaskId: string;
  fromKey: string;
  toArg: string;
};

export type TaskFailurePolicy = "required" | "best_effort";

export type TaskRuntimeHints = {
  autoApplyDraft?: boolean;
};

export type OrchestratedTask = {
  taskId: string;
  title: string;
  subagentId: string;
  subagentName: string;
  skillId: string;
  args: Record<string, unknown>;
  docIds: string[];
  sourceIntent: "command" | "keyword" | "llm-tool";
  dependsOn?: string[];
  inputBindings?: TaskInputBinding[];
  failurePolicy?: TaskFailurePolicy;
  runtimeHints?: TaskRuntimeHints;
  needsConfirmation?: boolean;
  reviewWarningMessage?: string;
};

export type ProvidePreflightInputPayload = {
  taskInputs: Array<{
    taskId: string;
    doc_id?: string;
    args?: Record<string, unknown>;
  }>;
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
      /**
       * Resolved skill id (lookup via agentSkillCatalog). We avoid persisting the
       * whole skill definition in graph state because it contains non-serializable
       * objects (e.g. Zod schemas) and breaks LangGraph checkpointing.
       */
      skillId: string;
      args: Record<string, unknown>;
      docIds: string[];
      sourceIntent: "command" | "keyword" | "llm-tool";
    }
  | {
      action: "execute_skill_batch";
      tasks: Array<{
        taskId: string;
        title: string;
        skillId: string;
        args: Record<string, unknown>;
        docIds: string[];
        sourceIntent: "command" | "keyword" | "llm-tool";
        dependsOn?: string[];
        inputBindings?: TaskInputBinding[];
        failurePolicy?: TaskFailurePolicy;
        runtimeHints?: TaskRuntimeHints;
      }>;
    }
  | { action: "deep_search" }
  | { action: "clarify_intent" }
  | { action: "respond_text"; text: string }
  | { action: "respond_blocked"; reason: string }
  | { action: "respond_rejected"; reason: string }
  | { action: "respond_error"; error: string };

/** Result of executing or resuming the chat graph */
export type ChatGraphResult =
  | { status: "complete"; plan: ChatExecutionPlan; intent: ChatIntent }
  | { status: "awaiting_confirmation"; pendingTool: PendingToolInfo; intent: ChatIntent }
  | { status: "awaiting_intent"; pendingIntent: PendingIntentInfo; intent: ChatIntent }
  | { status: "awaiting_preflight_input"; pendingPreflight: PendingPreflightInfo; intent: ChatIntent }
  | { status: "awaiting_input"; pendingInput: PendingRequiredInputInfo; intent: ChatIntent };

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
  intentCandidates: Annotation<IntentOption[] | undefined>(lv<IntentOption[] | undefined>(() => undefined)),

  // ---- Skill resolution ----
  matchedSkill: Annotation<string | null>(lv<string | null>(() => null)),
  skillArgs: Annotation<Record<string, unknown>>(lv<Record<string, unknown>>(() => ({}))),
  skillDocIds: Annotation<string[]>(lv<string[]>(() => [])),
  sourceIntent: Annotation<"command" | "keyword" | "llm-tool">(lv<"command" | "keyword" | "llm-tool">(() => "command")),
  plannedTasks: Annotation<OrchestratedTask[]>(lv<OrchestratedTask[]>(() => [])),

  // ---- Required input collection ----
  requiredInput: Annotation<PendingRequiredInputInfo | null>(lv<PendingRequiredInputInfo | null>(() => null)),
  preflightInfo: Annotation<PendingPreflightInfo | null>(lv<PendingPreflightInfo | null>(() => null)),

  // ---- Policy ----
  needsConfirmation: Annotation<boolean>(lv(() => false)),
  reviewWarningMessage: Annotation<string | undefined>(lv<string | undefined>(() => undefined)),

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

const COMMAND_REGEX = /^\/([a-z0-9][a-z0-9-]*)(?:\s+(.*))?$/;
const MAX_ORCHESTRATED_TASKS = 5;
const PPT_CREATE_SKILL_COMMAND = "/doc-create";
const PPT_COMPAT_SKILL_COMMAND = "/doc-optimize-ppt";
const PPT_OUTLINE_SKILL_COMMAND = "/doc-optimize-ppt-outline";
const PPT_HTML_RENDER_SKILL_COMMAND = "/doc-render-ppt-html";
const PPT_EXPORT_SKILL_COMMAND = "/doc-export-ppt";

// ============================================================================
// Node: detect_intent
// ============================================================================

const INTENT_CONFIDENCE_THRESHOLD = 0.85;
const INTENT_COMPETITOR_MIN_CONFIDENCE = 0.55;
const INTENT_COMPETITOR_GAP_MAX = 0.15;
const INTENT_MAX_OPTIONS = 4;

const INTENT_SYSTEM_PROMPT = `你是 Zeus 文档管理系统的意图分析器。根据用户消息判断其意图类型，并给出可能的候选意图。

输出严格 JSON 格式（不要包含 markdown 代码块标记）：
{
  "primary": {"type":"command|skill|deep_search|chat","confidence":0.0-1.0,"skill_hint":"可选的技能名","label":"用户可见的简短描述","reasoning":"简短推理"},
  "alternatives": [
    {"type":"...","confidence":0.0-1.0,"skill_hint":"...","label":"...","reasoning":"..."}
  ]
}

意图分类规则：
- command: 消息以 / 开头的显式斜杠命令
- skill: 用户明确想要执行文档操作（创建文档、编辑文档、删除文档、移动文档、优化文档、导入文档、格式转换、解析文件、识别图片、提取URL内容等）
- deep_search: 复杂问题，需要多轮检索和综合分析（"详细分析"、"全面调研"、"深入对比"、"系统整理"等）
- chat: 简单提问、知识检索、闲聊、或意图不明确的请求

skill_hint 可选值: doc-create, doc-edit, doc-delete, doc-move, doc-read, doc-summary, doc-optimize-format, doc-optimize-content, doc-optimize-style, doc-optimize-full, doc-optimize-ppt, doc-optimize-ppt-outline, doc-render-ppt-html, doc-export-ppt, kb-search, doc-fetch-url, doc-import-git, doc-smart-import, doc-organize, doc-convert, file-parse, image-analyze, url-extract

复合任务指导：
- 当用户请求“从主题制作/生成/做 PPT”且未指定文档时，优先判断为技能执行（通常由编排层自动拆成“创建文档 -> PPT化”）。
- 当用户已指定文档（如 @ 文档）时，优先倾向 doc-optimize-ppt。
- 仅当用户明确提到“导出/下载/pptx”时，才倾向额外导出步骤（doc-export-ppt）。

label 要求：简短的中文描述，让用户看到就能理解（如"搜索知识库"、"创建新文档"、"优化文档格式"、"深度分析"）。

alternatives 说明：
- 当意图非常明确时（confidence >= 0.85），alternatives 可为空数组
- 当存在多种合理解读时，列出其他候选（最多3个），每个 confidence > 0.3
- 始终确保 alternatives 中包含一个 type="chat" 的选项（label="直接对话"）作为兜底

示例：
用户: "帮我创建一篇关于API设计的文档"
→ {"primary":{"type":"skill","confidence":0.95,"skill_hint":"doc-create","label":"创建新文档","reasoning":"用户要求创建文档"},"alternatives":[]}

用户: "帮我整理一下API文档"
→ {"primary":{"type":"skill","confidence":0.6,"skill_hint":"doc-optimize-content","label":"优化文档内容","reasoning":"整理可能指优化"},"alternatives":[{"type":"chat","confidence":0.5,"label":"直接对话","reasoning":"也可能只是想讨论"},{"type":"skill","confidence":0.4,"skill_hint":"doc-edit","label":"编辑文档","reasoning":"整理也可能是编辑"}]}

用户: "这个项目的架构是什么？"
→ {"primary":{"type":"chat","confidence":0.9,"label":"搜索知识库","reasoning":"用户在提问"},"alternatives":[]}`;

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

  // LLM-based intent detection with candidate ranking
  try {
    const response = await llmGateway.chat({
      provider: llmConfig.providerId,
      model: llmConfig.defaultModel,
      messages: [
        { role: "system", content: INTENT_SYSTEM_PROMPT },
        { role: "user", content: state.userQuery },
      ],
      temperature: 0,
      maxTokens: 300,
      baseUrl: llmConfig.baseUrl,
      apiKey: llmConfig.apiKey,
      traceContext: state.traceContext,
    });

    const parsed = JSON.parse(response.content.trim()) as {
      primary?: {
        type?: string;
        confidence?: number;
        skill_hint?: string;
        label?: string;
        reasoning?: string;
      };
      alternatives?: Array<{
        type?: string;
        confidence?: number;
        skill_hint?: string;
        label?: string;
        reasoning?: string;
      }>;
      // Backward compatibility with old format
      type?: string;
      confidence?: number;
      skill_hint?: string;
      reasoning?: string;
    };

    // Support both new (primary/alternatives) and old (flat) format
    const primary = parsed.primary || {
      type: parsed.type,
      confidence: parsed.confidence,
      skill_hint: parsed.skill_hint,
      label: undefined,
      reasoning: parsed.reasoning,
    };

    const primaryIntent: ChatIntent = {
      type: (primary.type as ChatIntent["type"]) || "chat",
      confidence: primary.confidence ?? 0.5,
      skillHint: primary.skill_hint,
      reasoning: primary.reasoning,
    };

    // Build candidate list for potential clarification
    const alternatives = (parsed.alternatives || [])
      .filter((a) => a.type && (a.confidence ?? 0) > 0.3)
      .map((a) => ({
        type: (a.type as ChatIntent["type"]) || "chat",
        skillHint: a.skill_hint,
        label: a.label || a.type || "对话",
        confidence: a.confidence ?? 0,
      }));

    const primaryOption: IntentOption = {
      type: primaryIntent.type,
      skillHint: primaryIntent.skillHint,
      label: primary.label || labelForIntentType(primaryIntent.type, primaryIntent.skillHint),
      confidence: primaryIntent.confidence,
    };

    const candidates = buildIntentCandidateList(primaryOption, alternatives);
    const hasAlternatives = alternatives.length > 0;
    const lowConfidence = primaryIntent.confidence < INTENT_CONFIDENCE_THRESHOLD;
    const hasStrongCompetition = hasStrongIntentCompetition(candidates);

    // Clarify when:
    // 1) confidence is low for non-chat intents, or
    // 2) confidence is low for chat but we have alternative interpretations, or
    // 3) multiple intents are strong competitors (even if primary is high-confidence).
    const needsClarification =
      (lowConfidence && (primaryIntent.type !== "chat" || hasAlternatives))
      || (!lowConfidence && hasStrongCompetition);

    return {
      intent: primaryIntent,
      intentCandidates: needsClarification && candidates.length >= 2
        ? candidates
        : undefined,
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

/** Generate a default label for an intent type */
function labelForIntentType(type: ChatIntent["type"], skillHint?: string): string {
  if (skillHint) {
    const skillLabels: Record<string, string> = {
      "doc-create": "创建新文档",
      "doc-edit": "编辑文档",
      "doc-delete": "删除文档",
      "doc-move": "移动文档",
      "doc-read": "阅读文档",
      "doc-summary": "生成摘要",
      "doc-optimize-format": "优化文档格式",
      "doc-optimize-content": "优化文档内容",
      "doc-optimize-style": "优化文档风格",
      "doc-optimize-full": "全面优化文档",
      "doc-optimize-ppt": "PPT 化演示稿",
      "doc-optimize-ppt-outline": "生成 PPT 结构稿",
      "doc-render-ppt-html": "生成 HTML 演示稿",
      "doc-export-ppt": "导出 PPT",
      "kb-search": "搜索知识库",
      "doc-fetch-url": "抓取网页",
      "doc-import-git": "导入 Git 仓库",
      "doc-smart-import": "智能导入",
      "doc-organize": "整理文档结构",
      "doc-convert": "格式转换",
      "file-parse": "解析文件",
      "image-analyze": "识别图片",
      "url-extract": "提取网页内容",
    };
    return skillLabels[skillHint] || skillHint;
  }
  switch (type) {
    case "command": return "执行命令";
    case "skill": return "执行操作";
    case "deep_search": return "深度搜索";
    case "chat": return "直接对话";
    default: return "直接对话";
  }
}

/** Heuristic fallback when LLM is unavailable */
function heuristicIntent(message: string): ChatIntent {
  const lower = message.toLowerCase();
  const skillKeywords = [
    "创建文档", "新建文档", "编辑文档", "修改文档", "删除文档",
    "移动文档", "优化文档", "导入", "转换格式", "create doc",
    "edit doc", "delete doc", "move doc",
    "解析文件", "解析这个", "提取内容", "提取文字", "parse file",
    "识别图片", "图片识别", "ocr", "文字识别", "analyze image",
    "提取网页", "提取url", "extract url", "抓取网页",
    "制作ppt", "生成ppt", "做ppt", "演示稿", "幻灯片", "powerpoint",
    "导出ppt", "下载ppt", "pptx",
  ];
  const deepKeywords = [
    "详细分析", "全面调研", "深入了解", "系统整理", "全面分析",
    "深入对比", "综合评估",
  ];

  const hasPptKeyword = /(?:\bpptx?\b|演示稿|幻灯片|powerpoint|slides?)/i.test(lower);
  const hasPptAction = /(?:制作|生成|做|做成|整理成|输出|汇报|演示|导出|下载)/i.test(message);
  const hasExportIntent = /(?:导出|下载|pptx)/i.test(lower);

  if (deepKeywords.some((k) => lower.includes(k))) {
    return { type: "deep_search", confidence: 0.7, reasoning: "Keyword match: deep search" };
  }

  if (hasPptKeyword && hasPptAction) {
    return {
      type: "skill",
      confidence: 0.82,
      skillHint: hasExportIntent ? "doc-export-ppt" : "doc-optimize-ppt",
      reasoning: hasExportIntent ? "Keyword match: ppt export workflow" : "Keyword match: ppt workflow",
    };
  }

  if (skillKeywords.some((k) => lower.includes(k))) {
    return {
      type: "skill",
      confidence: 0.72,
      reasoning: "Keyword match: skill",
    };
  }

  return { type: "chat", confidence: 0.6, reasoning: "Default fallback" };
}

function intentOptionKey(option: IntentOption): string {
  return `${option.type}:${option.skillHint || ""}`;
}

function buildIntentCandidateList(
  primary: IntentOption,
  alternatives: IntentOption[],
): IntentOption[] {
  const byKey = new Map<string, IntentOption>();

  const all = [primary, ...alternatives];
  for (const opt of all) {
    if (!opt?.type) continue;
    const key = intentOptionKey(opt);
    const existing = byKey.get(key);
    if (!existing || opt.confidence > existing.confidence) {
      byKey.set(key, {
        type: opt.type,
        skillHint: opt.skillHint,
        label: opt.label || labelForIntentType(opt.type, opt.skillHint),
        confidence: typeof opt.confidence === "number" ? opt.confidence : 0,
      });
    }
  }

  // Always include a chat fallback option.
  if (![...byKey.values()].some((o) => o.type === "chat")) {
    byKey.set("chat:", { type: "chat", label: "直接对话", confidence: 0.01 });
  }

  // Ensure primary is present even if de-dup logic replaced it.
  byKey.set(intentOptionKey(primary), {
    type: primary.type,
    skillHint: primary.skillHint,
    label: primary.label || labelForIntentType(primary.type, primary.skillHint),
    confidence: primary.confidence,
  });

  const primaryKey = intentOptionKey(primary);
  const primaryItem = byKey.get(primaryKey)!;
  const chatItem = [...byKey.values()].find((o) => o.type === "chat")!;

  const others = [...byKey.values()]
    .filter((o) => intentOptionKey(o) !== primaryKey && o.type !== "chat")
    .sort((a, b) => b.confidence - a.confidence);

  const options: IntentOption[] = [primaryItem];
  for (const opt of others) {
    if (options.length >= INTENT_MAX_OPTIONS - 1) break; // reserve last slot for chat
    options.push(opt);
  }
  options.push(chatItem);

  // Deduplicate in case primary is chat.
  const seen = new Set<string>();
  const deduped: IntentOption[] = [];
  for (const opt of options) {
    const key = intentOptionKey(opt);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(opt);
  }

  return deduped;
}

function hasStrongIntentCompetition(options: IntentOption[]): boolean {
  const ranked = [...options].sort((a, b) => b.confidence - a.confidence);
  if (ranked.length < 2) return false;
  const top = ranked[0];
  const second = ranked[1];
  if (!top || !second) return false;
  return second.confidence >= INTENT_COMPETITOR_MIN_CONFIDENCE
    && (top.confidence - second.confidence) <= INTENT_COMPETITOR_GAP_MAX;
}

// ============================================================================
// Node: await_intent_selection (Human-in-the-Loop for intent clarification)
// ============================================================================

async function awaitIntentSelection(state: GraphState): Promise<Partial<GraphState>> {
  const candidates = state.intentCandidates || [];
  if (candidates.length === 0) {
    // Should not reach here, but fallback to current intent
    return {};
  }

  const pendingIntent: PendingIntentInfo = {
    message: "你想要执行哪个操作？",
    options: candidates,
  };

  // interrupt() pauses graph execution until the caller resumes.
  const response = interrupt(pendingIntent);

  // Parse the user's selection from the resume payload
  const selected =
    typeof response === "object" && response !== null && "type" in response
      ? (response as IntentOption)
      : null;

  if (selected) {
    return {
      intent: {
        type: selected.type,
        confidence: 1.0, // User explicitly selected
        skillHint: selected.skillHint,
        reasoning: `User selected: ${selected.label}`,
      },
      intentCandidates: undefined, // Clear candidates
    };
  }

  // Fallback: use the primary intent if selection is invalid
  return {
    intentCandidates: undefined,
  };
}

async function reviewAgent(state: GraphState): Promise<Partial<GraphState>> {
  const result = await runReviewAgent({
    matchedSkillId: state.matchedSkill,
    skillArgs: state.skillArgs,
    needsConfirmation: state.needsConfirmation,
    planAction: state.plan?.action,
  });

  return {
    matchedSkill: result.matchedSkillId,
    needsConfirmation: result.needsConfirmation,
    reviewWarningMessage: result.reviewWarningMessage,
    ...(result.plan ? { plan: result.plan as unknown as ChatExecutionPlan } : {}),
  };
}

function buildTaskId(index: number, skillId: string): string {
  const normalized = skillId.replace(/[^a-z0-9_-]/gi, "-");
  return `task-${index + 1}-${normalized}`;
}

function extractTerminalReasonFromPlan(
  plan: { action?: string; text?: string; reason?: string; error?: string } | null | undefined,
): string | null {
  if (!plan || typeof plan !== "object") return null;
  switch (plan.action) {
    case "respond_text":
      return typeof plan.text === "string" ? plan.text : null;
    case "respond_blocked":
      return typeof plan.reason === "string" ? plan.reason : null;
    case "respond_rejected":
      return typeof plan.reason === "string" ? plan.reason : null;
    case "respond_error":
      return typeof plan.error === "string" ? plan.error : null;
    default:
      return null;
  }
}

type WorkflowIntentKind = "none" | "ppt_from_topic" | "ppt_from_existing_doc";

type WorkflowIntent = {
  kind: WorkflowIntentKind;
  needsExport: boolean;
};

function hasDocumentScope(docIds?: string[]): boolean {
  return Array.isArray(docIds) && docIds.some((docId) => typeof docId === "string" && docId.trim().length > 0);
}

function inferWorkflowIntent(
  userQuery: string,
  docIds: string[] | undefined,
  intentSkillHint?: string,
): WorkflowIntent {
  const text = userQuery.trim();
  const lower = text.toLowerCase();

  const hasPptKeyword = /(?:\bpptx?\b|演示稿|幻灯片|slides?|powerpoint|汇报稿)/i.test(lower);
  const hasPptAction = /(?:制作|生成|做|准备|整理成|写成|输出)/i.test(text);
  const optimizeHint = intentSkillHint === "doc-optimize-ppt"
    || intentSkillHint === "doc-optimize-ppt-outline"
    || intentSkillHint === "doc-render-ppt-html";
  const exportHint = intentSkillHint === "doc-export-ppt";

  if (!hasPptKeyword && !optimizeHint && !exportHint) {
    return { kind: "none", needsExport: false };
  }

  const needsExport = exportHint || /(?:导出|下载|pptx|输出文件|生成文件)/i.test(lower);
  const scoped = hasDocumentScope(docIds);

  if (!hasPptAction && !optimizeHint && !exportHint && !scoped) {
    return { kind: "none", needsExport: false };
  }

  return {
    kind: scoped ? "ppt_from_existing_doc" : "ppt_from_topic",
    needsExport,
  };
}

function shouldDecomposeQuery(query: string): boolean {
  const text = query.trim();
  if (text.length < 12) return false;
  return /(?:然后|接着|随后|并且|同时|再|;|；|\n)/.test(text);
}

function splitQueryIntoSteps(query: string): string[] {
  const rawParts = query
    .split(/\s*(?:然后|接着|随后|并且|同时|;|；|\n)\s*/g)
    .map((part) => part.trim())
    .filter(Boolean);

  if (rawParts.length <= 1) {
    return [query.trim()].filter(Boolean);
  }

  return rawParts;
}

function taskFingerprint(task: OrchestratedTask): string {
  const docIds = [...task.docIds].sort().join(",");
  const depends = [...(task.dependsOn || [])].sort().join(",");
  const bindings = JSON.stringify((task.inputBindings || []).map((b) => ({
    fromTaskId: b.fromTaskId,
    fromKey: b.fromKey,
    toArg: b.toArg,
  })));
  const failurePolicy = task.failurePolicy || "required";
  const hints = JSON.stringify(task.runtimeHints || {});
  return `${task.skillId}|${JSON.stringify(task.args)}|${docIds}|${task.sourceIntent}|${depends}|${bindings}|${failurePolicy}|${hints}`;
}

function remapTaskDependencies(tasks: OrchestratedTask[], idMap: Map<string, string>): OrchestratedTask[] {
  return tasks.map((task) => ({
    ...task,
    dependsOn: task.dependsOn?.map((taskId) => idMap.get(taskId) || taskId),
    inputBindings: task.inputBindings?.map((binding) => ({
      ...binding,
      fromTaskId: idMap.get(binding.fromTaskId) || binding.fromTaskId,
    })),
  }));
}

function buildTask(
  index: number,
  skillId: string,
  skillName: string,
  args: Record<string, unknown>,
  docIds: string[],
  sourceIntent: "command" | "keyword" | "llm-tool",
  extras?: Pick<OrchestratedTask, "dependsOn" | "inputBindings" | "failurePolicy" | "runtimeHints">,
): OrchestratedTask {
  return {
    taskId: buildTaskId(index, skillId),
    title: skillName,
    subagentId: skillId,
    subagentName: skillName,
    skillId,
    args,
    docIds,
    sourceIntent,
    ...(extras?.dependsOn ? { dependsOn: extras.dependsOn } : {}),
    ...(extras?.inputBindings ? { inputBindings: extras.inputBindings } : {}),
    ...(extras?.failurePolicy ? { failurePolicy: extras.failurePolicy } : {}),
    ...(extras?.runtimeHints ? { runtimeHints: extras.runtimeHints } : {}),
  };
}

type WorkflowBuildResult =
  | { tasks: OrchestratedTask[] }
  | { blockedReason: string }
  | null;

async function buildPptWorkflowTasks(state: GraphState, workflow: WorkflowIntent): Promise<WorkflowBuildResult> {
  if (workflow.kind === "none") return null;

  await agentSkillCatalog.initialize();
  const allSkills = agentSkillCatalog.getAllSkills(state.userId);
  const enabledSkillIds = new Set(
    await projectSkillConfigStore.getEnabledSkillIds(state.projectKey, allSkills),
  );

  const createSkill = agentSkillCatalog.getByCommand(PPT_CREATE_SKILL_COMMAND, state.userId);
  const outlineSkill = agentSkillCatalog.getByCommand(PPT_OUTLINE_SKILL_COMMAND, state.userId);
  const htmlSkill = agentSkillCatalog.getByCommand(PPT_HTML_RENDER_SKILL_COMMAND, state.userId);
  const exportSkill = agentSkillCatalog.getByCommand(PPT_EXPORT_SKILL_COMMAND, state.userId);

  const requiredMissing: string[] = [];
  if (!outlineSkill || !enabledSkillIds.has(outlineSkill.id)) {
    requiredMissing.push(PPT_OUTLINE_SKILL_COMMAND);
  }
  if (!htmlSkill || !enabledSkillIds.has(htmlSkill.id)) {
    requiredMissing.push(PPT_HTML_RENDER_SKILL_COMMAND);
  }
  if (workflow.kind === "ppt_from_topic" && (!createSkill || !enabledSkillIds.has(createSkill.id))) {
    requiredMissing.push(PPT_CREATE_SKILL_COMMAND);
  }

  if (requiredMissing.length > 0) {
    return {
      blockedReason: `PPT 双阶段流程依赖技能未启用：${requiredMissing.join("、")}`,
    };
  }

  if (workflow.needsExport && (!exportSkill || !enabledSkillIds.has(exportSkill.id))) {
    return {
      blockedReason: `请求包含导出，但技能 ${PPT_EXPORT_SKILL_COMMAND} 未启用。`,
    };
  }

  const sourceIntent = state.sourceIntent;
  const scopedDocIds = hasDocumentScope(state.docIds)
    ? (state.docIds || [])
    : (state.skillDocIds || []);

  const outlineBaseArgs = { ...(state.skillArgs || {}) };
  const htmlBaseArgs: Record<string, unknown> = {};
  if (typeof state.skillArgs?.theme === "string" && state.skillArgs.theme.trim().length > 0) {
    htmlBaseArgs.theme = state.skillArgs.theme.trim();
  }

  const tasks: OrchestratedTask[] = [];

  if (workflow.kind === "ppt_from_topic") {
    const createArgs = buildCommandArgs(createSkill!, state.userQuery.trim(), scopedDocIds);
    const createTask = buildTask(
      tasks.length,
      createSkill!.id,
      createSkill!.displayName || createSkill!.id,
      createArgs,
      [],
      sourceIntent,
      {
        failurePolicy: "required",
        runtimeHints: { autoApplyDraft: true },
      },
    );
    tasks.push(createTask);

    const outlineArgs = { ...outlineBaseArgs };
    if (typeof outlineArgs.doc_id === "string") {
      delete outlineArgs.doc_id;
    }

    const outlineTask = buildTask(
      tasks.length,
      outlineSkill!.id,
      outlineSkill!.displayName || outlineSkill!.id,
      outlineArgs,
      [],
      sourceIntent,
      {
        dependsOn: [createTask.taskId],
        inputBindings: [{ fromTaskId: createTask.taskId, fromKey: "docId", toArg: "doc_id" }],
        failurePolicy: "required",
        runtimeHints: { autoApplyDraft: true },
      },
    );
    tasks.push(outlineTask);
  } else {
    const outlineTask = buildTask(
      tasks.length,
      outlineSkill!.id,
      outlineSkill!.displayName || outlineSkill!.id,
      outlineBaseArgs,
      scopedDocIds,
      sourceIntent,
      {
        failurePolicy: "required",
        runtimeHints: { autoApplyDraft: true },
      },
    );
    tasks.push(outlineTask);
  }

  const outlineTask = tasks[tasks.length - 1]!;
  const htmlTask = buildTask(
    tasks.length,
    htmlSkill!.id,
    htmlSkill!.displayName || htmlSkill!.id,
    htmlBaseArgs,
    [],
    sourceIntent,
    {
      dependsOn: [outlineTask.taskId],
      inputBindings: [{ fromTaskId: outlineTask.taskId, fromKey: "docId", toArg: "doc_id" }],
      failurePolicy: "best_effort",
      runtimeHints: { autoApplyDraft: true },
    },
  );
  tasks.push(htmlTask);

  if (workflow.needsExport && exportSkill && enabledSkillIds.has(exportSkill.id)) {
    const exportTask = buildTask(
      tasks.length,
      exportSkill.id,
      exportSkill.displayName || exportSkill.id,
      {},
      [],
      sourceIntent,
      {
        dependsOn: [outlineTask.taskId],
        inputBindings: [{ fromTaskId: outlineTask.taskId, fromKey: "docId", toArg: "doc_id" }],
        failurePolicy: "required",
      },
    );
    tasks.push(exportTask);
  }

  return {
    tasks: tasks.slice(0, MAX_ORCHESTRATED_TASKS),
  };
}

async function orchestrateTasks(state: GraphState): Promise<Partial<GraphState>> {
  const skillId = state.matchedSkill;
  if (!skillId) {
    return { plannedTasks: [] };
  }

  await agentSkillCatalog.initialize();
  const currentSkill = agentSkillCatalog.getById(skillId, state.userId);
  const currentName = currentSkill?.displayName || skillId;

  const baseTask: OrchestratedTask = {
    taskId: buildTaskId(0, skillId),
    title: currentName,
    subagentId: skillId,
    subagentName: currentName,
    skillId,
    args: state.skillArgs || {},
    docIds: state.skillDocIds || [],
    sourceIntent: state.sourceIntent,
  };

  let tasks: OrchestratedTask[] = [baseTask];

  const currentLegacySkill = typeof currentSkill?.metadata?.legacySkillName === "string"
    ? currentSkill.metadata.legacySkillName
    : undefined;

  const workflow = inferWorkflowIntent(
    state.userQuery,
    hasDocumentScope(state.docIds) ? state.docIds : state.skillDocIds,
    state.intent.skillHint || currentLegacySkill,
  );

  const hasScopedDocIds = hasDocumentScope(state.docIds) || hasDocumentScope(state.skillDocIds);
  const shouldApplyWorkflowTemplate = workflow.kind !== "none"
    && (
      (state.intent.type === "skill" && state.sourceIntent !== "command")
      || (currentLegacySkill === "doc-optimize-ppt" && hasScopedDocIds)
    );

  if (shouldApplyWorkflowTemplate) {
    const workflowBuildResult = await buildPptWorkflowTasks(state, workflow);
    if (workflowBuildResult && "blockedReason" in workflowBuildResult) {
      return {
        plannedTasks: [],
        plan: {
          action: "respond_blocked",
          reason: workflowBuildResult.blockedReason,
        },
      };
    }

    if (workflowBuildResult && "tasks" in workflowBuildResult && workflowBuildResult.tasks.length > 0) {
      tasks = workflowBuildResult.tasks;
    }
  }

  if (tasks.length === 1) {
    const canDecompose = state.intent.type === "skill"
      && state.sourceIntent !== "command"
      && workflow.kind === "none"
      && shouldDecomposeQuery(state.userQuery);

    if (canDecompose) {
      const steps = splitQueryIntoSteps(state.userQuery).slice(0, MAX_ORCHESTRATED_TASKS);
      for (const step of steps.slice(1)) {
        const planned = await runPlannerAgent({
          userQuery: step,
          messages: state.messages,
          projectKey: state.projectKey,
          userId: state.userId,
          docIds: state.docIds,
          attachments: state.attachments,
          llmConfig: state.llmConfig,
          traceContext: state.traceContext,
        });

        if (!planned.matchedSkillId) continue;

        const plannedSkill = agentSkillCatalog.getById(planned.matchedSkillId, state.userId);
        const plannedName = plannedSkill?.displayName || planned.matchedSkillId;

        tasks.push({
          taskId: buildTaskId(tasks.length, planned.matchedSkillId),
          title: plannedName,
          subagentId: planned.matchedSkillId,
          subagentName: plannedName,
          skillId: planned.matchedSkillId,
          args: planned.skillArgs,
          docIds: planned.skillDocIds,
          sourceIntent: planned.sourceIntent,
        });

        if (tasks.length >= MAX_ORCHESTRATED_TASKS) {
          break;
        }
      }
    }
  }

  const uniqueTasks: OrchestratedTask[] = [];
  const seen = new Set<string>();
  const oldToNewTaskId = new Map<string, string>();

  for (const task of tasks) {
    const key = taskFingerprint(task);
    if (seen.has(key)) continue;
    seen.add(key);

    const nextTaskId = buildTaskId(uniqueTasks.length, task.skillId);
    oldToNewTaskId.set(task.taskId, nextTaskId);
    uniqueTasks.push({
      ...task,
      taskId: nextTaskId,
    });
  }

  const remappedTasks = remapTaskDependencies(uniqueTasks, oldToNewTaskId);
  const firstTask = remappedTasks[0];

  return {
    plannedTasks: remappedTasks,
    matchedSkill: firstTask?.skillId || state.matchedSkill,
    skillArgs: firstTask?.args || state.skillArgs,
    skillDocIds: firstTask?.docIds || state.skillDocIds,
    sourceIntent: firstTask?.sourceIntent || state.sourceIntent,
  };
}
function toPreflightMissingInput(
  taskId: string,
  requiredInput: PendingRequiredInputInfo,
): PreflightMissingInput {
  if (requiredInput.kind === "doc_scope") {
    return {
      taskId,
      kind: "doc_scope",
      skillName: requiredInput.skillName,
      message: requiredInput.message,
    };
  }

  return {
    taskId,
    kind: "skill_args",
    skillName: requiredInput.skillName,
    message: requiredInput.message,
    fields: requiredInput.fields,
    missing: requiredInput.missing,
    issues: requiredInput.issues,
    currentArgs: requiredInput.currentArgs,
  };
}

async function preflightValidate(state: GraphState): Promise<Partial<GraphState>> {
  const fallbackTasks: OrchestratedTask[] = state.matchedSkill
    ? [{
        taskId: buildTaskId(0, state.matchedSkill),
        title: state.matchedSkill,
        subagentId: state.matchedSkill,
        subagentName: state.matchedSkill,
        skillId: state.matchedSkill,
        args: state.skillArgs || {},
        docIds: state.skillDocIds || [],
        sourceIntent: state.sourceIntent,
      }]
    : [];

  const inputTasks = (state.plannedTasks.length > 0 ? state.plannedTasks : fallbackTasks)
    .slice(0, MAX_ORCHESTRATED_TASKS);

  if (inputTasks.length === 0) {
    return { preflightInfo: null };
  }

  await agentSkillCatalog.initialize();
  const normalizedTasks: OrchestratedTask[] = [];
  const tasks: PreflightTaskInfo[] = [];
  const missingInputs: PreflightMissingInput[] = [];
  const blockedReasons: string[] = [];
  const reviewWarnings: string[] = [];
  const taskStatus = new Map<string, PreflightTaskInfo["status"]>();

  for (const task of inputTasks) {
    const unresolvedDependencies = (task.dependsOn || []).filter((depTaskId) => taskStatus.get(depTaskId) !== "ready");
    const unresolvedBindingSources = (task.inputBindings || [])
      .filter((binding) => {
        const currentValue = task.args?.[binding.toArg];
        if (typeof currentValue === "string") return currentValue.trim().length === 0;
        return currentValue === undefined || currentValue === null;
      })
      .map((binding) => `${binding.fromTaskId}.${binding.fromKey}`);

    if (unresolvedDependencies.length > 0 || unresolvedBindingSources.length > 0) {
      const waitingSkill = agentSkillCatalog.getById(task.skillId, state.userId);
      const waitingTask: OrchestratedTask = {
        ...task,
        needsConfirmation: task.needsConfirmation
          ?? (!state.fullAccess && Boolean(waitingSkill?.risk.requireConfirmation)),
      };
      const waitingSources = [...unresolvedDependencies, ...unresolvedBindingSources];
      normalizedTasks.push(waitingTask);
      tasks.push({
        taskId: task.taskId,
        title: task.title,
        subagentId: task.subagentId,
        subagentName: task.subagentName,
        status: "waiting_dependency",
        reason: `等待依赖任务输出: ${waitingSources.join(", ")}`,
      });
      taskStatus.set(task.taskId, "waiting_dependency");
      continue;
    }

    const docResult = await runDocAgent({
      userId: state.userId,
      matchedSkillId: task.skillId,
      skillArgs: task.args,
      skillDocIds: task.docIds,
      sourceIntent: task.sourceIntent,
      fullAccess: state.fullAccess,
    });

    const validatedSkillId = docResult.matchedSkillId;
    const skill = validatedSkillId ? agentSkillCatalog.getById(validatedSkillId, state.userId) : undefined;
    const subagentName = skill?.displayName || task.subagentName || task.skillId;
    const taskBase: OrchestratedTask = {
      ...task,
      title: task.title || subagentName,
      subagentId: validatedSkillId || task.subagentId,
      subagentName,
      skillId: validatedSkillId || task.skillId,
      args: docResult.skillArgs,
      docIds: docResult.skillDocIds,
    };

    if (!validatedSkillId) {
      const reason = extractTerminalReasonFromPlan(docResult.plan || null) || "该任务未解析到可执行技能。";
      tasks.push({
        taskId: task.taskId,
        title: task.title,
        subagentId: task.subagentId,
        subagentName: task.subagentName,
        status: "blocked",
        reason,
      });
      blockedReasons.push(`${task.title}: ${reason}`);
      taskStatus.set(task.taskId, "blocked");
      continue;
    }

    if (docResult.requiredInput) {
      normalizedTasks.push(taskBase);
      tasks.push({
        taskId: task.taskId,
        title: taskBase.title,
        subagentId: taskBase.subagentId,
        subagentName: taskBase.subagentName,
        status: "missing_input",
        reason: docResult.requiredInput.message,
      });
      missingInputs.push(toPreflightMissingInput(task.taskId, docResult.requiredInput as PendingRequiredInputInfo));
      taskStatus.set(task.taskId, "missing_input");
      continue;
    }

    const reviewResult = await runReviewAgent({
      matchedSkillId: validatedSkillId,
      skillArgs: docResult.skillArgs,
      needsConfirmation: docResult.needsConfirmation,
      planAction: docResult.plan?.action,
    });

    const reviewReason = extractTerminalReasonFromPlan(reviewResult.plan || null);
    if (reviewReason) {
      tasks.push({
        taskId: task.taskId,
        title: taskBase.title,
        subagentId: taskBase.subagentId,
        subagentName: taskBase.subagentName,
        status: "blocked",
        reason: reviewReason,
      });
      blockedReasons.push(`${taskBase.title}: ${reviewReason}`);
      taskStatus.set(task.taskId, "blocked");
      continue;
    }

    const readyTask: OrchestratedTask = {
      ...taskBase,
      needsConfirmation: Boolean(reviewResult.needsConfirmation),
      reviewWarningMessage: reviewResult.reviewWarningMessage,
    };
    normalizedTasks.push(readyTask);
    tasks.push({
      taskId: task.taskId,
      title: taskBase.title,
      subagentId: taskBase.subagentId,
      subagentName: taskBase.subagentName,
      status: "ready",
    });
    taskStatus.set(task.taskId, "ready");

    if (reviewResult.reviewWarningMessage) {
      reviewWarnings.push(`${taskBase.title}: ${reviewResult.reviewWarningMessage}`);
    }
  }

  if (missingInputs.length > 0) {
    return {
      plannedTasks: normalizedTasks,
      preflightInfo: {
        message: "执行前需要补充必要信息",
        tasks,
        missingInputs,
      },
      requiredInput: null,
    };
  }

  if (blockedReasons.length > 0) {
    return {
      plannedTasks: normalizedTasks,
      preflightInfo: null,
      requiredInput: null,
      matchedSkill: null,
      needsConfirmation: false,
      reviewWarningMessage: undefined,
      plan: {
        action: "respond_text",
        text: `以下任务无法执行：
${blockedReasons.map((reason, index) => `${index + 1}. ${reason}`).join("\n")}`,
      },
    };
  }

  const executableTasks = normalizedTasks;
  if (executableTasks.length === 0) {
    return {
      plannedTasks: [],
      preflightInfo: null,
      requiredInput: null,
      matchedSkill: null,
      needsConfirmation: false,
      plan: { action: "respond_text", text: "未生成可执行任务。" },
    };
  }

  if (executableTasks.length === 1 && !(executableTasks[0]?.dependsOn && executableTasks[0].dependsOn.length > 0)) {
    const task = executableTasks[0];
    return {
      plannedTasks: executableTasks,
      preflightInfo: null,
      requiredInput: null,
      matchedSkill: task.skillId,
      skillArgs: task.args,
      skillDocIds: task.docIds,
      sourceIntent: task.sourceIntent,
      needsConfirmation: Boolean(task.needsConfirmation),
      reviewWarningMessage: task.reviewWarningMessage,
      plan: {
        action: "execute_skill",
        skillId: task.skillId,
        args: task.args,
        docIds: task.docIds,
        sourceIntent: task.sourceIntent,
      },
    };
  }

  const batchNeedsConfirmation = executableTasks.some((task) => task.needsConfirmation);

  return {
    plannedTasks: executableTasks,
    preflightInfo: null,
    requiredInput: null,
    matchedSkill: executableTasks[0]?.skillId || null,
    skillArgs: executableTasks[0]?.args || {},
    skillDocIds: executableTasks[0]?.docIds || [],
    sourceIntent: executableTasks[0]?.sourceIntent || state.sourceIntent,
    needsConfirmation: batchNeedsConfirmation,
    reviewWarningMessage: reviewWarnings.length > 0 ? reviewWarnings.join("\n") : undefined,
    plan: {
      action: "execute_skill_batch",
      tasks: executableTasks.map((task) => ({
        taskId: task.taskId,
        title: task.title,
        skillId: task.skillId,
        args: task.args,
        docIds: task.docIds,
        sourceIntent: task.sourceIntent,
        ...(task.dependsOn ? { dependsOn: task.dependsOn } : {}),
        ...(task.inputBindings ? { inputBindings: task.inputBindings } : {}),
        ...(task.failurePolicy ? { failurePolicy: task.failurePolicy } : {}),
        ...(task.runtimeHints ? { runtimeHints: task.runtimeHints } : {}),
      })),
    },
  };
}

type PreflightTaskInput = {
  taskId?: string;
  doc_id?: unknown;
  args?: unknown;
};

function parsePreflightTaskInputs(
  response: unknown,
  defaultTaskId: string,
): PreflightTaskInput[] {
  if (!response || typeof response !== "object") return [];
  const obj = response as Record<string, unknown>;

  if (Array.isArray(obj.taskInputs)) {
    return obj.taskInputs
      .filter((item) => item && typeof item === "object")
      .map((item) => {
        const input = item as Record<string, unknown>;
        return {
          taskId: typeof input.taskId === "string" ? input.taskId : undefined,
          doc_id: input.doc_id,
          args: input.args,
        } satisfies PreflightTaskInput;
      });
  }

  // Backward-compatible shape for single-task payloads.
  return [{
    taskId: defaultTaskId,
    doc_id: obj.doc_id,
    args: obj.args,
  } satisfies PreflightTaskInput];
}

async function awaitPreflightInput(state: GraphState): Promise<Partial<GraphState>> {
  const preflight = state.preflightInfo;
  if (!preflight || preflight.missingInputs.length === 0) {
    return {};
  }

  const response = interrupt(preflight);

  const primaryTaskId = preflight.missingInputs[0]?.taskId || preflight.tasks[0]?.taskId || "task";
  const inputs = parsePreflightTaskInputs(response, primaryTaskId);

  if (inputs.length === 0) {
    return {
      preflightInfo: null,
      requiredInput: null,
      plannedTasks: [],
      matchedSkill: null,
      plan: { action: "respond_text", text: "未补充必要信息，已取消该操作。" },
      intent: { type: "chat", confidence: 1.0, reasoning: "Missing preflight input cancelled" },
    };
  }

  const byTaskId = new Map<string, PreflightTaskInput>();
  for (const item of inputs) {
    if (!item.taskId) continue;
    byTaskId.set(item.taskId, item);
  }

  const currentTasks = state.plannedTasks.length > 0
    ? state.plannedTasks
    : (state.matchedSkill
      ? [{
          taskId: primaryTaskId,
          title: state.matchedSkill,
          subagentId: state.matchedSkill,
          subagentName: state.matchedSkill,
          skillId: state.matchedSkill,
          args: state.skillArgs || {},
          docIds: state.skillDocIds || [],
          sourceIntent: state.sourceIntent,
        }]
      : []);

  let hasUsefulInput = false;
  const nextTasks = currentTasks.map((task) => {
    const provided = byTaskId.get(task.taskId);
    if (!provided) return task;

    let nextArgs = { ...(task.args || {}) };
    let nextDocIds = [...(task.docIds || [])];

    const docId = typeof provided.doc_id === "string" ? provided.doc_id.trim() : "";
    if (docId) {
      nextArgs = { ...nextArgs, doc_id: docId };
      nextDocIds = [docId];
      hasUsefulInput = true;
    }

    if (provided.args && typeof provided.args === "object" && !Array.isArray(provided.args)) {
      const argsUpdate = provided.args as Record<string, unknown>;
      if (Object.keys(argsUpdate).length > 0) {
        nextArgs = { ...nextArgs, ...argsUpdate };
        hasUsefulInput = true;
        const argDocId = typeof nextArgs.doc_id === "string" ? nextArgs.doc_id.trim() : "";
        if (argDocId) {
          nextDocIds = [argDocId];
        }
      }
    }

    return {
      ...task,
      args: nextArgs,
      docIds: nextDocIds,
    };
  });

  if (!hasUsefulInput) {
    return {
      preflightInfo: null,
      requiredInput: null,
      plannedTasks: [],
      matchedSkill: null,
      plan: { action: "respond_text", text: "未提供必要参数，已取消该操作。" },
      intent: { type: "chat", confidence: 1.0, reasoning: "Missing preflight input cancelled" },
    };
  }

  const first = nextTasks[0];
  return {
    preflightInfo: null,
    requiredInput: null,
    plannedTasks: nextTasks,
    ...(first
      ? {
          matchedSkill: first.skillId,
          skillArgs: first.args,
          skillDocIds: first.docIds,
          sourceIntent: first.sourceIntent,
          docIds: first.docIds.length > 0
            ? first.docIds
            : state.docIds,
        }
      : {}),
  };
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
  const skill = agentSkillCatalog.getByCommand(command, state.userId);

  if (!skill) {
    return { matchedSkill: null };
  }

  // Check if enabled
  const allSkills = agentSkillCatalog.getAllSkills(state.userId);
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
    matchedSkill: skill.id,
    skillArgs: args,
    skillDocIds: state.docIds || [],
    sourceIntent: "command",
  };
}

// ============================================================================
// Node: plan_skill
// ============================================================================

async function planSkill(state: GraphState): Promise<Partial<GraphState>> {
  const planned = await runPlannerAgent({
    userQuery: state.userQuery,
    messages: state.messages,
    projectKey: state.projectKey,
    userId: state.userId,
    docIds: state.docIds,
    attachments: state.attachments,
    skillHint: state.intent.skillHint,
    llmConfig: state.llmConfig,
    traceContext: state.traceContext,
  });

  let matchedSkillId = planned.matchedSkillId;
  let skillArgs = planned.skillArgs;
  let skillDocIds = planned.skillDocIds;
  let sourceIntent = planned.sourceIntent;

  if (!matchedSkillId && state.intent.skillHint) {
    await agentSkillCatalog.initialize();
    const hintedSkill = agentSkillCatalog.getByCommand(`/${state.intent.skillHint}`, state.userId);
    if (hintedSkill) {
      const allSkills = agentSkillCatalog.getAllSkills(state.userId);
      const enabledIds = new Set(
        await projectSkillConfigStore.getEnabledSkillIds(state.projectKey, allSkills),
      );
      if (enabledIds.has(hintedSkill.id)) {
        matchedSkillId = hintedSkill.id;
        skillDocIds = state.docIds || [];
        skillArgs = buildCommandArgs(hintedSkill, state.userQuery.trim(), skillDocIds);
        sourceIntent = "keyword";
      }
    }
  }

  const nextDocIds = (!state.docIds || state.docIds.length === 0) && skillDocIds.length > 0
    ? skillDocIds
    : state.docIds;

  return {
    matchedSkill: matchedSkillId,
    skillArgs,
    skillDocIds,
    sourceIntent,
    ...(nextDocIds ? { docIds: nextDocIds } : {}),
    ...(!matchedSkillId && planned.respondText
      ? { plan: { action: "respond_text", text: planned.respondText } }
      : {}),
  };
}

// ============================================================================
// Node: await_confirmation (Human-in-the-Loop via interrupt)
// ============================================================================

async function awaitConfirmation(state: GraphState): Promise<Partial<GraphState>> {
  if (state.plan.action === "execute_skill_batch") {
    const tasks = state.plan.tasks;
    const warnings = [state.reviewWarningMessage]
      .filter((w): w is string => typeof w === "string" && w.trim().length > 0);

    const response = interrupt({
      skillName: `批量任务执行 (${tasks.length})`,
      skillDescription: tasks.map((task, index) => `${index + 1}. ${task.title}`).join("\n"),
      args: {
        tasks: tasks.map((task) => ({
          taskId: task.taskId,
          title: task.title,
          skillId: task.skillId,
          docIds: task.docIds,
        })),
      },
      riskLevel: "high" as AgentRiskLevel,
      warningMessage: warnings.length > 0 ? warnings.join("\n") : undefined,
    } satisfies PendingToolInfo);

    const confirmed =
      typeof response === "object" && response !== null && "confirmed" in response
        ? !!(response as { confirmed: boolean }).confirmed
        : !!response;

    if (confirmed) {
      return {};
    }

    return {
      plan: { action: "respond_rejected", reason: "操作已取消" },
    };
  }

  const skillId = state.matchedSkill;
  if (!skillId) {
    return { plan: { action: "respond_error", error: "No skill resolved in await_confirmation" } };
  }

  await agentSkillCatalog.initialize();
  const skill = agentSkillCatalog.getById(skillId, state.userId);
  if (!skill) {
    return {
      matchedSkill: null,
      plan: { action: "respond_error", error: `Unknown skill: ${skillId}` },
    };
  }

  // interrupt() pauses graph execution.
  // The interrupt payload is surfaced to the caller via graph state inspection.
  // When the caller resumes with Command({ resume: { confirmed } }),
  // interrupt() returns that value.
  const warnings = [
    skill.risk.warningMessage,
    state.reviewWarningMessage,
  ].filter((w): w is string => typeof w === "string" && w.trim().length > 0);

  const warningMessage = warnings.length > 0 ? warnings.join("\n") : undefined;

  const response = interrupt({
    skillName: skill.displayName,
    skillDescription: skill.description,
    args: state.skillArgs,
    riskLevel: skill.risk.level,
    warningMessage,
  } satisfies PendingToolInfo);

  const confirmed =
    typeof response === "object" && response !== null && "confirmed" in response
      ? !!(response as { confirmed: boolean }).confirmed
      : !!response;

  if (confirmed) {
    return {
      plan: {
        action: "execute_skill",
        skillId,
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
  try {
    const { ragContext, ragSources } = await runRetrievalAgent({
      userQuery: state.userQuery,
      userId: state.userId,
      projectKey: state.projectKey,
      docIds: state.docIds,
      traceContext: state.traceContext,
    });

    return {
      ragContext,
      // RetrievalAgentSourceReference shape is compatible with GraphSourceReference.
      ragSources: ragSources as unknown as GraphSourceReference[],
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
  // If intent is uncertain and we have candidates, ask the user
  if (state.intentCandidates && state.intentCandidates.length > 0) {
    return "await_intent_selection";
  }

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

/** Route after user selects an intent (re-routes the same as routeAfterIntent but without clarification) */
function routeAfterIntentSelection(state: GraphState): string {
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
  // If a skill was found, orchestrate tasks via supervisor
  if (state.matchedSkill) return "orchestrate_tasks";
  // No skill found — fallback to chat
  return "rag_retrieve";
}

function routeAfterPlanSkill(state: GraphState): string {
  // If skill matched, orchestrate tasks via supervisor
  if (state.matchedSkill) return "orchestrate_tasks";
  // If plan_skill explicitly produced a text response, go to END
  if (state.plan.action === "respond_text") return "__end__";
  // No skill matched and no explicit plan — fallback to chat (rag)
  return "rag_retrieve";
}

function routeAfterOrchestrateTasks(state: GraphState): string {
  if (state.plan.action === "respond_text" || state.plan.action === "respond_blocked") {
    return "__end__";
  }

  if (state.plannedTasks.length > 0 || state.matchedSkill) {
    return "preflight_validate";
  }

  return "rag_retrieve";
}

function routeAfterPreflightValidate(state: GraphState): string {
  if (state.plan.action === "respond_text" || state.plan.action === "respond_blocked") {
    return "__end__";
  }

  if (state.preflightInfo && state.preflightInfo.missingInputs.length > 0) {
    return "await_preflight_input";
  }

  if (state.needsConfirmation) {
    return "await_confirmation";
  }

  if (state.plan.action === "execute_skill" || state.plan.action === "execute_skill_batch") {
    return "__end__";
  }

  return "review_agent";
}

function routeAfterReviewAgent(state: GraphState): string {
  // Terminal text/block responses should always end, even if needsConfirmation is stale.
  if (state.plan.action === "respond_text" || state.plan.action === "respond_blocked" || state.plan.action === "respond_rejected") {
    return "__end__";
  }

  if (state.needsConfirmation) return "await_confirmation";
  return "__end__";
}

function routeAfterAwaitPreflightInput(state: GraphState): string {
  if (state.plan.action === "respond_text") return "__end__";
  return "preflight_validate";
}

// ============================================================================
// Graph Definition
// ============================================================================

const checkpointer = new MemorySaver();

const chatGraph = new StateGraph(ChatGraphState)
  // Nodes
  .addNode("detect_intent", detectIntent)
  .addNode("await_intent_selection", awaitIntentSelection)
  .addNode("resolve_command", resolveCommand)
  .addNode("plan_skill", planSkill)
  .addNode("orchestrate_tasks", orchestrateTasks)
  .addNode("preflight_validate", preflightValidate)
  .addNode("await_preflight_input", awaitPreflightInput)
  .addNode("review_agent", reviewAgent)
  .addNode("await_confirmation", awaitConfirmation)
  .addNode("rag_retrieve", ragRetrieve)
  .addNode("build_response", buildResponse)
  .addNode("prepare_deep_search", prepareDeepSearch)

  // Edges: START → detect_intent
  .addEdge(START, "detect_intent")

  // detect_intent → 5-way routing (includes intent clarification)
  .addConditionalEdges("detect_intent", routeAfterIntent, {
    await_intent_selection: "await_intent_selection",
    resolve_command: "resolve_command",
    plan_skill: "plan_skill",
    rag_retrieve: "rag_retrieve",
    prepare_deep_search: "prepare_deep_search",
  })

  // await_intent_selection → re-route based on user's selection
  .addConditionalEdges("await_intent_selection", routeAfterIntentSelection, {
    resolve_command: "resolve_command",
    plan_skill: "plan_skill",
    rag_retrieve: "rag_retrieve",
    prepare_deep_search: "prepare_deep_search",
  })

  // resolve_command → orchestrate_tasks | rag_retrieve | END
  .addConditionalEdges("resolve_command", routeAfterResolveCommand, {
    orchestrate_tasks: "orchestrate_tasks",
    rag_retrieve: "rag_retrieve",
    __end__: END,
  })

  // plan_skill → orchestrate_tasks | rag_retrieve | END
  .addConditionalEdges("plan_skill", routeAfterPlanSkill, {
    orchestrate_tasks: "orchestrate_tasks",
    rag_retrieve: "rag_retrieve",
    __end__: END,
  })

  // orchestrate_tasks → preflight_validate | rag_retrieve | END
  .addConditionalEdges("orchestrate_tasks", routeAfterOrchestrateTasks, {
    preflight_validate: "preflight_validate",
    rag_retrieve: "rag_retrieve",
    __end__: END,
  })

  // preflight_validate → await_preflight_input | await_confirmation | review_agent | END
  .addConditionalEdges("preflight_validate", routeAfterPreflightValidate, {
    await_preflight_input: "await_preflight_input",
    await_confirmation: "await_confirmation",
    review_agent: "review_agent",
    __end__: END,
  })

  // await_preflight_input → preflight_validate | END
  .addConditionalEdges("await_preflight_input", routeAfterAwaitPreflightInput, {
    preflight_validate: "preflight_validate",
    __end__: END,
  })

  // review_agent → await_confirmation | END
  .addConditionalEdges("review_agent", routeAfterReviewAgent, {
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
 * May return "complete" with a plan, "awaiting_confirmation" if the graph
 * interrupted at the await_confirmation node, or "awaiting_intent" if the
 * graph needs the user to clarify their intent.
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

  return classifyGraphResult(result, config);
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

  return classifyGraphResult(result, config);
}

/**
 * Resume the chat graph after user selects an intent option.
 *
 * @param runId          The same runId used in executeChatGraph
 * @param selectedOption The intent option the user picked
 */
export async function resumeChatGraphWithIntent(
  runId: string,
  selectedOption: IntentOption,
): Promise<ChatGraphResult> {
  const config = { configurable: { thread_id: runId } };

  const result = await chatGraph.invoke(
    new Command({ resume: selectedOption }),
    config,
  );

  return classifyGraphResult(result, config);
}

/**
 * Resume the chat graph after user provides required input (e.g. doc scope).
 */
export async function resumeChatGraphWithRequiredInput(
  runId: string,
  input: Record<string, unknown>,
): Promise<ChatGraphResult> {
  const config = { configurable: { thread_id: runId } };

  const result = await chatGraph.invoke(
    new Command({ resume: input }),
    config,
  );

  return classifyGraphResult(result, config);
}

/**
 * Resume the chat graph after user provides preflight task inputs.
 */
export async function resumeChatGraphWithPreflightInput(
  runId: string,
  input: Record<string, unknown>,
): Promise<ChatGraphResult> {
  const config = { configurable: { thread_id: runId } };

  const result = await chatGraph.invoke(
    new Command({ resume: input }),
    config,
  );

  return classifyGraphResult(result, config);
}

/**
 * Classify the graph result as complete, awaiting_confirmation, or awaiting_intent.
 */
async function classifyGraphResult(
  result: Record<string, unknown>,
  config: { configurable: { thread_id: string } },
): Promise<ChatGraphResult> {
  const snapshot = await chatGraph.getState(config);
  const isInterrupted = snapshot.next && snapshot.next.length > 0;

  if (isInterrupted) {
    const interruptPayload = extractInterruptValue(snapshot);

    // Check if this is an intent clarification interrupt
    if (isIntentInterrupt(interruptPayload)) {
      return {
        status: "awaiting_intent",
        pendingIntent: interruptPayload as PendingIntentInfo,
        intent: result.intent as ChatIntent,
      };
    }

    if (isRequiredInputInterrupt(interruptPayload)) {
      return {
        status: "awaiting_input",
        pendingInput: interruptPayload as PendingRequiredInputInfo,
        intent: result.intent as ChatIntent,
      };
    }

    if (isPreflightInterrupt(interruptPayload)) {
      return {
        status: "awaiting_preflight_input",
        pendingPreflight: interruptPayload as PendingPreflightInfo,
        intent: result.intent as ChatIntent,
      };
    }

    // Otherwise it's a tool confirmation interrupt
    const skillId = typeof result.matchedSkill === "string" ? result.matchedSkill : "";
    const userId = typeof result.userId === "string" ? result.userId : "";
    await agentSkillCatalog.initialize();
    const skill = skillId ? agentSkillCatalog.getById(skillId, userId) : undefined;
    return {
      status: "awaiting_confirmation",
      pendingTool: (interruptPayload as PendingToolInfo) || {
        skillName: skill?.displayName || "Unknown",
        skillDescription: skill?.description || "",
        args: (result.skillArgs as Record<string, unknown>) || {},
        riskLevel: skill?.risk?.level || "medium",
      },
      intent: result.intent as ChatIntent,
    };
  }

  return {
    status: "complete",
    plan: result.plan as ChatExecutionPlan,
    intent: result.intent as ChatIntent,
  };
}

/** Check if an interrupt payload is an intent clarification request */
function isIntentInterrupt(payload: unknown): payload is PendingIntentInfo {
  if (!payload || typeof payload !== "object") return false;
  const obj = payload as Record<string, unknown>;
  return "message" in obj && "options" in obj && Array.isArray(obj.options);
}

function isRequiredInputInterrupt(payload: unknown): payload is PendingRequiredInputInfo {
  if (!payload || typeof payload !== "object") return false;
  const obj = payload as Record<string, unknown>;

  if (
    obj.kind === "doc_scope"
    && typeof obj.message === "string"
    && typeof obj.skillName === "string"
    && typeof obj.skillDescription === "string"
  ) {
    return true;
  }

  if (
    obj.kind === "skill_args"
    && typeof obj.message === "string"
    && typeof obj.skillName === "string"
    && typeof obj.skillDescription === "string"
    && Array.isArray(obj.fields)
  ) {
    return true;
  }

  return false;
}

function isPreflightInterrupt(payload: unknown): payload is PendingPreflightInfo {
  if (!payload || typeof payload !== "object") return false;
  const obj = payload as Record<string, unknown>;
  return (
    typeof obj.message === "string"
    && Array.isArray(obj.tasks)
    && Array.isArray(obj.missingInputs)
  );
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extract the interrupt value from a graph state snapshot.
 * Returns the raw interrupt payload (could be PendingToolInfo or PendingIntentInfo).
 */
function extractInterruptValue(
  snapshot: Awaited<ReturnType<typeof chatGraph.getState>>,
): unknown {
  try {
    // LangGraph stores interrupt values in snapshot.tasks[].interrupts[].value
    const tasks = (snapshot as unknown as Record<string, unknown>).tasks;
    if (Array.isArray(tasks)) {
      for (const task of tasks) {
        const interrupts = (task as Record<string, unknown>).interrupts;
        if (Array.isArray(interrupts) && interrupts.length > 0) {
          return interrupts[0].value;
        }
      }
    }
  } catch {
    // ignore extraction errors
  }
  return null;
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
