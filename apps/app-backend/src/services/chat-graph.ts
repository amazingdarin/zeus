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
import { enrichResultsWithHierarchy } from "../knowledge/hierarchy.js";
import { documentStore } from "../storage/document-store.js";
import { ragTraceManager } from "../observability/index.js";
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
export type PendingRequiredInputInfo = {
  kind: "doc_scope";
  message: string;
  skillName: string;
  skillDescription: string;
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
  matchedSkill: Annotation<AgentSkillDefinition | null>(lv<AgentSkillDefinition | null>(() => null)),
  skillArgs: Annotation<Record<string, unknown>>(lv<Record<string, unknown>>(() => ({}))),
  skillDocIds: Annotation<string[]>(lv<string[]>(() => [])),
  sourceIntent: Annotation<"command" | "keyword" | "llm-tool">(lv<"command" | "keyword" | "llm-tool">(() => "command")),

  // ---- Required input collection ----
  requiredInput: Annotation<PendingRequiredInputInfo | null>(lv<PendingRequiredInputInfo | null>(() => null)),

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

skill_hint 可选值: doc-create, doc-edit, doc-delete, doc-move, doc-read, doc-summary, doc-optimize-format, doc-optimize-content, doc-optimize-style, doc-optimize-full, kb-search, doc-fetch-url, doc-import-git, doc-smart-import, doc-organize, doc-convert, file-parse, image-analyze, url-extract

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

// ============================================================================
// Node: validate_requirements / await_required_input
// ============================================================================

function skillRequiresDocScope(skill: AgentSkillDefinition): boolean {
  return Boolean((skill.metadata as Record<string, unknown> | undefined)?.requiresDocScope);
}

function hasDocScope(
  args: Record<string, unknown>,
  docIds: string[],
): boolean {
  if (docIds.length > 0) return true;
  const raw = args.doc_id;
  return typeof raw === "string" && raw.trim().length > 0;
}

async function validateRequirements(state: GraphState): Promise<Partial<GraphState>> {
  const skill = state.matchedSkill;
  if (!skill) return { requiredInput: null };

  if (skillRequiresDocScope(skill) && !hasDocScope(state.skillArgs, state.skillDocIds)) {
    return {
      requiredInput: {
        kind: "doc_scope",
        message: "该操作需要指定文档。请选择要操作的文档后继续。",
        skillName: skill.displayName,
        skillDescription: skill.description,
      },
    };
  }

  return { requiredInput: null };
}

async function awaitRequiredInput(state: GraphState): Promise<Partial<GraphState>> {
  const req = state.requiredInput;
  if (!req) {
    return {};
  }

  const response = interrupt(req);

  const selectedDocId =
    typeof response === "object" && response !== null && "doc_id" in response
      ? String((response as { doc_id?: unknown }).doc_id ?? "").trim()
      : "";

  if (!selectedDocId) {
    return {
      requiredInput: null,
      matchedSkill: null,
      plan: { action: "respond_text", text: "未选择文档，已取消该操作。" },
      intent: { type: "chat", confidence: 1.0, reasoning: "Missing required input cancelled" },
    };
  }

  return {
    requiredInput: null,
    docIds: [selectedDocId],
    skillDocIds: [selectedDocId],
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

  // Step 0: Auto-detect parse skill from attachments + skill_hint
  // When the user has file/image attachments and the intent hints at a parse
  // skill, automatically fill in the asset_id from the first matching attachment.
  if (state.intent.skillHint && state.attachments && state.attachments.length > 0) {
    const autoResult = autoDetectParseSkill(
      state.intent.skillHint,
      state.attachments,
      state.userQuery.trim(),
      enabledIds,
    );
    if (autoResult) {
      return {
        matchedSkill: autoResult.skill,
        skillArgs: autoResult.args,
        skillDocIds: state.docIds || [],
        sourceIntent: "llm-tool",
      };
    }
  }

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

      // Enrich args with attachment asset_id for parse skills
      if (isParseSkill(state.intent.skillHint) && state.attachments?.length) {
        enrichParseArgsWithAttachment(args, state.intent.skillHint, state.attachments);
      }

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
        content: `当前可用附件(可用于导入或解析):\n${lines}\n\n提示: 图片附件可用 image-analyze 解析; 文档附件(PDF/Word/HTML等)可用 file-parse 解析; URL 可用 url-extract 提取。`,
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
    const tc = state.traceContext;

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
        traceContext: tc,
      },
    );

    if (results.length === 0) {
      return { ragContext: "", ragSources: [] };
    }

    // Load hierarchy context (populates document_summary_cache on demand)
    let hierarchyPrefix = "";
    const hierarchySpan = tc ? ragTraceManager.startHierarchySpan(tc, results.map((r) => r.doc_id)) : null;
    try {
      const { contextString } = await enrichResultsWithHierarchy(
        state.userId,
        state.projectKey,
        results,
      );
      if (contextString) {
        hierarchyPrefix = contextString + "\n\n";
      }
      if (hierarchySpan) {
        ragTraceManager.endHierarchySpan(hierarchySpan, contextString ? contextString.split("\n").length : 0);
      }
    } catch (err) {
      console.warn("[ChatGraph] Hierarchy context loading failed:", err);
      if (hierarchySpan) {
        ragTraceManager.endHierarchySpan(hierarchySpan, 0);
      }
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
      ragContext: hierarchyPrefix + contextParts.join("\n\n---\n\n"),
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
  // If a skill was found, validate requirements first
  if (state.matchedSkill) return "validate_requirements";
  // No skill found — fallback to chat
  return "rag_retrieve";
}

function routeAfterPlanSkill(state: GraphState): string {
  // If skill matched, validate requirements first
  if (state.matchedSkill) return "validate_requirements";
  // If plan_skill explicitly produced a text response, go to END
  if (state.plan.action === "respond_text") return "__end__";
  // No skill matched and no explicit plan — fallback to chat (rag)
  return "rag_retrieve";
}

function routeAfterValidateRequirements(state: GraphState): string {
  if (state.requiredInput) return "await_required_input";
  return "check_policy";
}

function routeAfterAwaitRequiredInput(state: GraphState): string {
  // If user cancelled, we might have produced a text response.
  if (state.plan.action === "respond_text") return "__end__";
  return "validate_requirements";
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
  .addNode("await_intent_selection", awaitIntentSelection)
  .addNode("resolve_command", resolveCommand)
  .addNode("plan_skill", planSkill)
  .addNode("validate_requirements", validateRequirements)
  .addNode("await_required_input", awaitRequiredInput)
  .addNode("check_policy", checkPolicy)
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

  // resolve_command → check_policy | rag_retrieve | END
  .addConditionalEdges("resolve_command", routeAfterResolveCommand, {
    validate_requirements: "validate_requirements",
    rag_retrieve: "rag_retrieve",
    __end__: END,
  })

  // plan_skill → check_policy | rag_retrieve | END
  .addConditionalEdges("plan_skill", routeAfterPlanSkill, {
    validate_requirements: "validate_requirements",
    rag_retrieve: "rag_retrieve",
    __end__: END,
  })

  // validate_requirements → await_required_input | check_policy
  .addConditionalEdges("validate_requirements", routeAfterValidateRequirements, {
    await_required_input: "await_required_input",
    check_policy: "check_policy",
  })

  // await_required_input → validate_requirements | END
  .addConditionalEdges("await_required_input", routeAfterAwaitRequiredInput, {
    validate_requirements: "validate_requirements",
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
  input: { doc_id: string },
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

    // Otherwise it's a tool confirmation interrupt
    return {
      status: "awaiting_confirmation",
      pendingTool: (interruptPayload as PendingToolInfo) || {
        skillName: (result.matchedSkill as AgentSkillDefinition | null)?.displayName || "Unknown",
        skillDescription: (result.matchedSkill as AgentSkillDefinition | null)?.description || "",
        args: (result.skillArgs as Record<string, unknown>) || {},
        riskLevel: (result.matchedSkill as AgentSkillDefinition | null)?.risk?.level || "medium",
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
  return obj.kind === "doc_scope"
    && typeof obj.message === "string"
    && typeof obj.skillName === "string"
    && typeof obj.skillDescription === "string";
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

// ============================================================================
// Parse skill auto-detection helpers
// ============================================================================

const PARSE_SKILL_NAMES = new Set(["file-parse", "image-analyze", "url-extract"]);

const IMAGE_MIME_PREFIXES = ["image/"];
const DOCUMENT_MIMES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/html",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
]);

function isParseSkill(skillHint: string): boolean {
  return PARSE_SKILL_NAMES.has(skillHint);
}

/**
 * Auto-detect which parse skill to use based on attachments.
 * Returns the matched skill + filled-in args, or null if no match.
 */
function autoDetectParseSkill(
  skillHint: string,
  attachments: ChatGraphAttachment[],
  userQuery: string,
  enabledIds: Set<string>,
): { skill: AgentSkillDefinition; args: Record<string, unknown> } | null {
  if (!isParseSkill(skillHint)) return null;

  const hintCommand = `/${skillHint}`;
  const skill = agentSkillCatalog.getByCommand(hintCommand);
  if (!skill || !enabledIds.has(skill.id)) return null;

  const firstAttachment = attachments[0];
  if (!firstAttachment) return null;

  const mime = firstAttachment.mimeType?.toLowerCase() || "";
  const isImg = IMAGE_MIME_PREFIXES.some((p) => mime.startsWith(p))
    || firstAttachment.type === "image";
  const isDoc = DOCUMENT_MIMES.has(mime) || firstAttachment.type === "file";

  // Match skillHint to attachment type
  if (skillHint === "image-analyze" && isImg) {
    return {
      skill,
      args: { asset_id: firstAttachment.assetId, question: userQuery || undefined },
    };
  }

  if (skillHint === "file-parse" && (isDoc || !isImg)) {
    return {
      skill,
      args: { asset_id: firstAttachment.assetId },
    };
  }

  // url-extract doesn't use attachments, skip auto-detect
  return null;
}

/**
 * Enrich args with asset_id from attachments when user didn't explicitly
 * provide one (e.g. via skill_hint + attachment auto-detection).
 */
function enrichParseArgsWithAttachment(
  args: Record<string, unknown>,
  skillHint: string,
  attachments: ChatGraphAttachment[],
): void {
  if (!attachments.length) return;

  const first = attachments[0];

  if ((skillHint === "file-parse" || skillHint === "image-analyze") && !args.asset_id) {
    args.asset_id = first.assetId;
  }

  // For image-analyze, if the user query isn't the asset_id itself, keep it as question
  if (skillHint === "image-analyze" && !args.question && typeof args.asset_id === "string") {
    // args already have asset_id filled; leave question for the executor
  }
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
    case "doc-organize":
      return {};
    case "doc-convert":
      return { content: trimmed, from: "txt", to: "markdown" };
    case "file-parse":
      return { asset_id: trimmed };
    case "image-analyze":
      return { asset_id: trimmed };
    case "url-extract":
      return { url: trimmed };
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
