import {
  Annotation,
  END,
  START,
  StateGraph,
} from "@langchain/langgraph";
import type { ProviderConfigInternal } from "../../llm/index.js";
import { llmGateway } from "../../llm/index.js";
import {
  agentSkillCatalog,
  projectSkillConfigStore,
  type AgentSkillDefinition,
} from "../../llm/agent/index.js";
import type { TraceContext } from "../../observability/index.js";

export type PlannerAgentAttachment = {
  assetId: string;
  name?: string;
  mimeType?: string;
  size?: number;
  type?: string;
};

export type PlannerAgentInput = {
  userQuery: string;
  messages: Array<{ role: string; content: string }>;
  projectKey: string;
  docIds?: string[];
  attachments?: PlannerAgentAttachment[];
  /** From intent detection (optional hint about which skill to use). */
  skillHint?: string;
  llmConfig: ProviderConfigInternal | null;
  traceContext?: TraceContext;
};

export type PlannerAgentOutput = {
  matchedSkillId: string | null;
  skillArgs: Record<string, unknown>;
  skillDocIds: string[];
  sourceIntent: "command" | "keyword" | "llm-tool";
  respondText?: string;
};

type PlannerDomain = "doc" | "kb" | "img" | "code" | "mcp" | "general" | "all";

/** Helper: last-value reducer with a default. Required by @langchain/langgraph ^0.2 */
function lv<T>(defaultFn: () => T) {
  return { value: (_prev: T, next: T) => next, default: defaultFn };
}

const PlannerGraphState = Annotation.Root({
  // ---- Input ----
  userQuery: Annotation<string>,
  messages: Annotation<Array<{ role: string; content: string }>>,
  projectKey: Annotation<string>,
  docIds: Annotation<string[] | undefined>(lv<string[] | undefined>(() => undefined)),
  attachments: Annotation<PlannerAgentAttachment[] | undefined>(lv<PlannerAgentAttachment[] | undefined>(() => undefined)),
  skillHint: Annotation<string | undefined>(lv<string | undefined>(() => undefined)),
  llmConfig: Annotation<ProviderConfigInternal | null>(lv<ProviderConfigInternal | null>(() => null)),
  traceContext: Annotation<TraceContext | undefined>(lv<TraceContext | undefined>(() => undefined)),

  // ---- Internal ----
  enabledSkillIds: Annotation<string[]>(lv<string[]>(() => [])),
  plannerDomain: Annotation<PlannerDomain>(lv<PlannerDomain>(() => "doc")),
  candidateSkillIds: Annotation<string[]>(lv<string[]>(() => [])),

  // ---- Output ----
  matchedSkillId: Annotation<string | null>(lv<string | null>(() => null)),
  skillArgs: Annotation<Record<string, unknown>>(lv<Record<string, unknown>>(() => ({}))),
  skillDocIds: Annotation<string[]>(lv<string[]>(() => [])),
  sourceIntent: Annotation<"command" | "keyword" | "llm-tool">(
    lv<"command" | "keyword" | "llm-tool">(() => "llm-tool"),
  ),
  respondText: Annotation<string | undefined>(lv<string | undefined>(() => undefined)),
});

type PlannerState = typeof PlannerGraphState.State;

// ============================================================================
// Helpers (Planner-only)
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

function looksLikeDocImportIntent(message: string): boolean {
  const text = (message || "").trim();
  if (!text) return false;
  const lower = text.toLowerCase();

  // Strong intent tokens: "import/save/create as document/note/markdown"
  if (/(智能导入|smart\s*import)/i.test(lower)) return true;

  const docNouns = /(文档|笔记|note|document|markdown|\bmd\b)/i;
  const docVerbs = /(导入|导进去|保存为|写成|生成|新建|创建|归档|整理成|转换成|转成|convert|import|save|create|archive)/i;

  if (docVerbs.test(lower) && docNouns.test(lower)) return true;

  // Common Chinese pattern: "导入成文档/转成文档/生成文档"
  if (/(导入|保存为|写成|生成|新建|创建|归档|转换成|转成)\s*(?:一个|成|为)?\s*(文档|笔记)/i.test(lower)) {
    return true;
  }

  return false;
}

function looksLikeImageAnalyzeIntent(message: string): boolean {
  const text = (message || "").trim();
  if (!text) return false;
  const lower = text.toLowerCase();

  return /(ocr|识别|提取文字|提取内容|读图|图上写了什么|图片内容|图像识别|看下这张图|分析图片|analy[sz]e\s+(?:this\s+)?image|extract\s+text|what'?s\s+in\s+this\s+image|caption)/i.test(lower);
}

function domainLabel(domain: PlannerDomain): string {
  switch (domain) {
    case "doc":
      return "文档";
    case "kb":
      return "知识库";
    case "img":
      return "图像";
    case "code":
      return "代码";
    case "mcp":
      return "MCP";
    case "general":
      return "通用";
    case "all":
      return "全域";
    default:
      return "通用";
  }
}

function buildToolSelectionPrompt(domain: PlannerDomain, toolNames: string[]): string {
  const label = domainLabel(domain);
  const extraRules: Record<PlannerDomain, string> = {
    doc: "优先处理文档创建/编辑/优化/导入/转换/解析等操作。",
    kb: "优先处理知识库检索与结果汇总（例如 kb-search）。",
    img: "优先处理图片分析与 OCR（例如 image-analyze）。",
    code: "优先处理代码相关任务（分析、修改、运行、测试等）。",
    mcp: "优先使用 MCP 工具完成外部系统查询/操作（注意权限与副作用）。",
    general: "优先使用通用技能完成任务。",
    all: "在所有技能中选择最匹配的技能。",
  };

  return `你是 Zeus ${label} Planner。根据用户请求选择最匹配的技能。

可用技能: ${toolNames.join(", ")}

要求:
1. 只有在任务明确且需要执行动作时才调用技能
2. 参数尽量从用户消息中完整提取
3. ${extraRules[domain] || extraRules.general}
4. 如果没有合适技能，直接回答文本`;
}

function extractDocIdsFromArgs(
  args: Record<string, unknown>,
  contextDocIds?: string[],
): string[] {
  if (args.doc_id && typeof args.doc_id === "string") {
    return [args.doc_id];
  }
  return contextDocIds || [];
}

function attachmentLooksLikeImage(att: PlannerAgentAttachment): boolean {
  const mime = att.mimeType?.toLowerCase() || "";
  if (mime) {
    if (IMAGE_MIME_PREFIXES.some((p) => mime.startsWith(p))) return true;
  }
  return att.type === "image";
}

function inferPlannerDomainFromText(message: string): PlannerDomain {
  const lower = message.toLowerCase();

  // Knowledge/search intent
  if (/(知识库|检索|搜索|查询|search|lookup)/i.test(lower)) return "kb";

  // Code-related intent
  if (/(代码|报错|错误|异常|trace|stack|typescript|javascript|node|go|rust|python|sql)/i.test(lower)) return "code";

  // Explicit MCP mention
  if (/\bmcp\b/i.test(lower)) return "mcp";

  return "doc";
}

export function inferPlannerDomainFromAttachmentsAndText(input: {
  userQuery: string;
  docIds?: string[];
  attachments?: PlannerAgentAttachment[];
}): PlannerDomain {
  const userQuery = input.userQuery || "";
  const textDomain = inferPlannerDomainFromText(userQuery);

  const atts = input.attachments || [];
  if (atts.length === 0) {
    // When user is already scoped to a document, assume doc-oriented tasks by default.
    if (input.docIds && input.docIds.length > 0) return "doc";
    return textDomain;
  }

  // Code and MCP intents should win even with attachments (e.g., screenshots of errors).
  if (textDomain === "code" || textDomain === "mcp") return textDomain;

  const hasImage = atts.some(attachmentLooksLikeImage);
  const hasNonImage = atts.some((a) => !attachmentLooksLikeImage(a));

  // Any non-image attachment is treated as document-oriented (import/parse).
  if (hasNonImage) return "doc";

  // Only-image attachments: decide between "doc import" and "image analyze".
  if (hasImage) {
    if (looksLikeDocImportIntent(userQuery)) return "doc";
    if (looksLikeImageAnalyzeIntent(userQuery)) return "img";
    return "doc"; // Default: turn images into documents rather than ad-hoc OCR.
  }

  return textDomain;
}

function domainFromCategory(category: string | undefined): PlannerDomain {
  switch (category) {
    case "doc":
      return "doc";
    case "kb":
      return "kb";
    case "img":
      return "img";
    case "code":
      return "code";
    case "mcp":
      return "mcp";
    case "general":
      return "general";
    default:
      return "general";
  }
}

function filterEnabledSkillIdsByDomain(
  enabledSkillIds: string[],
  domain: PlannerDomain,
): string[] {
  if (domain === "all") return enabledSkillIds;

  const enabled = new Set(enabledSkillIds);
  const all = agentSkillCatalog.getAllSkills().filter((s) => enabled.has(s.id));

  return all
    .filter((s) => domainFromCategory(s.category) === domain)
    .map((s) => s.id);
}

/**
 * Auto-detect which parse skill to use based on attachments.
 * Returns the matched skill + filled-in args, or null if no match.
 */
function autoDetectParseSkill(
  skillHint: string,
  attachments: PlannerAgentAttachment[],
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

function enrichParseArgsWithAttachment(
  args: Record<string, unknown>,
  skillHint: string,
  attachments: PlannerAgentAttachment[],
): void {
  if (!attachments.length) return;

  const first = attachments[0];

  if ((skillHint === "file-parse" || skillHint === "image-analyze") && !args.asset_id) {
    args.asset_id = first.assetId;
  }
}

/**
 * Build args for a command-style skill invocation.
 *
 * NOTE: This is shared between command-path parsing and planner-based parsing
 * to keep argument heuristics consistent.
 */
export function buildCommandArgs(
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
      return { title: trimmed || "新文档", description: trimmed, parent_id: firstDocId || undefined };
    case "doc-edit":
      return { instructions: trimmed };
    case "doc-read":
    case "doc-summary":
      return {};
    case "doc-optimize-format":
    case "doc-optimize-content":
    case "doc-optimize-full":
    case "doc-optimize-ppt":
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

// ============================================================================
// PlannerAgent Subgraph Nodes
// ============================================================================

async function initEnabledSkills(state: PlannerState): Promise<Partial<PlannerState>> {
  await agentSkillCatalog.initialize();
  const allSkills = agentSkillCatalog.getAllSkills();
  const enabledSkillIds = await projectSkillConfigStore.getEnabledSkillIds(state.projectKey, allSkills);
  return { enabledSkillIds, candidateSkillIds: enabledSkillIds };
}

async function selectDomain(state: PlannerState): Promise<Partial<PlannerState>> {
  const enabled = new Set(state.enabledSkillIds);
  const hint = (state.skillHint || "").trim();

  // 1) Prefer intent skillHint when it maps to an enabled skill.
  if (hint) {
    const hinted = agentSkillCatalog.getByCommand(`/${hint}`);
    if (hinted && enabled.has(hinted.id)) {
      const domain = domainFromCategory(hinted.category);
      return {
        plannerDomain: domain,
        candidateSkillIds: [],
      };
    }
  }

  // 2) Attachment + text heuristic routing
  const domain = inferPlannerDomainFromAttachmentsAndText({
    userQuery: state.userQuery,
    docIds: state.docIds,
    attachments: state.attachments,
  });
  return {
    plannerDomain: domain,
    candidateSkillIds: [],
  };
}

async function autoParseFromAttachments(state: PlannerState): Promise<Partial<PlannerState>> {
  if (state.matchedSkillId || state.respondText) return {};

  const hint = state.skillHint;
  const atts = state.attachments;
  if (!hint || !atts || atts.length === 0) return {};

  const enabledIds = new Set(state.enabledSkillIds);
  const autoResult = autoDetectParseSkill(
    hint,
    atts,
    state.userQuery.trim(),
    enabledIds,
  );
  if (!autoResult) return {};

  return {
    matchedSkillId: autoResult.skill.id,
    skillArgs: autoResult.args,
    skillDocIds: state.docIds || [],
    sourceIntent: "llm-tool",
  };
}

async function keywordMatch(state: PlannerState): Promise<Partial<PlannerState>> {
  if (state.matchedSkillId || state.respondText) return {};

  const enabledIds = new Set(state.candidateSkillIds);
  if (enabledIds.size === 0) return {};
  const keywordMatch = agentSkillCatalog.matchAnthropicByKeywords(
    state.userQuery.trim(),
    enabledIds,
  );
  if (!keywordMatch) return {};

  return {
    matchedSkillId: keywordMatch.id,
    skillArgs: { request: state.userQuery.trim() },
    skillDocIds: state.docIds || [],
    sourceIntent: "keyword",
  };
}

async function hintMatch(state: PlannerState): Promise<Partial<PlannerState>> {
  if (state.matchedSkillId || state.respondText) return {};

  const hint = state.skillHint;
  if (!hint) return {};

  const enabledIds = new Set(state.enabledSkillIds);
  const hintCommand = `/${hint}`;
  const hintSkill = agentSkillCatalog.getByCommand(hintCommand);
  if (!hintSkill || !enabledIds.has(hintSkill.id)) return {};

  const args = buildCommandArgs(hintSkill, state.userQuery.trim(), state.docIds);

  // Enrich args with attachment asset_id for parse skills
  if (isParseSkill(hint) && state.attachments?.length) {
    enrichParseArgsWithAttachment(args, hint, state.attachments);
  }

  return {
    matchedSkillId: hintSkill.id,
    skillArgs: args,
    skillDocIds: state.docIds || [],
    sourceIntent: "llm-tool",
  };
}

async function llmToolSelect(state: PlannerState): Promise<Partial<PlannerState>> {
  if (state.matchedSkillId || state.respondText) return {};

  const config = state.llmConfig;
  if (!config?.enabled || !config.defaultModel) {
    return {};
  }

  const enabledIds = new Set(state.candidateSkillIds);
  if (enabledIds.size === 0) return {};
  const tools = agentSkillCatalog.toOpenAITools(enabledIds);
  if (tools.length === 0) return {};

  try {
    const systemPrompt = buildToolSelectionPrompt(state.plannerDomain, tools.map((t) => t.function.name));
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
          matchedSkillId: skill.id,
          skillArgs: args,
          skillDocIds: extractDocIdsFromArgs(args, state.docIds),
          sourceIntent: "llm-tool",
        };
      }
    }

    // LLM chose to respond with text instead of a tool
    if (response.content?.trim()) {
      return {
        matchedSkillId: null,
        respondText: response.content.trim(),
      };
    }
  } catch (err) {
    console.warn("[PlannerAgent] LLM tool selection failed:", err);
  }

  return {};
}

function createDomainPlannerSubgraph(name: string, domain: PlannerDomain) {
  const setCandidates = async (state: PlannerState): Promise<Partial<PlannerState>> => {
    const candidateSkillIds = filterEnabledSkillIdsByDomain(state.enabledSkillIds, domain);
    return {
      plannerDomain: domain,
      candidateSkillIds,
    };
  };

  // NOTE: This subgraph runs with `checkpointer: false` so it won't persist state.
  // We keep inputs/outputs serializable (strings, arrays, plain objects).
  return new StateGraph(PlannerGraphState)
    .addNode("set_candidates", setCandidates)
    .addNode("keyword_match", keywordMatch)
    .addNode("hint_match", hintMatch)
    .addNode("llm_tool_select", llmToolSelect)
    .addEdge(START, "set_candidates")
    .addEdge("set_candidates", "keyword_match")
    .addEdge("keyword_match", "hint_match")
    .addEdge("hint_match", "llm_tool_select")
    .addEdge("llm_tool_select", END)
    .compile({ checkpointer: false, name });
}

const docPlannerSubgraph = createDomainPlannerSubgraph("doc_planner", "doc");
const kbPlannerSubgraph = createDomainPlannerSubgraph("kb_planner", "kb");
const imgPlannerSubgraph = createDomainPlannerSubgraph("img_planner", "img");
const codePlannerSubgraph = createDomainPlannerSubgraph("code_planner", "code");
const mcpPlannerSubgraph = createDomainPlannerSubgraph("mcp_planner", "mcp");
const generalPlannerSubgraph = createDomainPlannerSubgraph("general_planner", "general");
const allPlannerSubgraph = createDomainPlannerSubgraph("all_planner", "all");

async function fallbackToAll(state: PlannerState): Promise<Partial<PlannerState>> {
  return {
    plannerDomain: "all",
    candidateSkillIds: [],
  };
}

async function afterDomain(_state: PlannerState): Promise<Partial<PlannerState>> {
  return {};
}

function routeToDomainPlanner(state: PlannerState): string {
  if (state.matchedSkillId || state.respondText) return "__end__";

  switch (state.plannerDomain) {
    case "kb":
      return "kb_planner";
    case "img":
      return "img_planner";
    case "code":
      return "code_planner";
    case "mcp":
      return "mcp_planner";
    case "general":
      return "general_planner";
    case "all":
      return "all_planner";
    case "doc":
    default:
      return "doc_planner";
  }
}

function routeAfterDomain(state: PlannerState): string {
  if (state.matchedSkillId || state.respondText) return "__end__";
  if (state.plannerDomain !== "all") return "fallback_all";
  return "__end__";
}

// ============================================================================
// PlannerAgent Supervisor Graph Definition
// ============================================================================

export const plannerAgentGraph = new StateGraph(PlannerGraphState)
  .addNode("init_enabled", initEnabledSkills)
  .addNode("select_domain", selectDomain)
  .addNode("auto_parse", autoParseFromAttachments)
  .addNode("doc_planner", docPlannerSubgraph)
  .addNode("kb_planner", kbPlannerSubgraph)
  .addNode("img_planner", imgPlannerSubgraph)
  .addNode("code_planner", codePlannerSubgraph)
  .addNode("mcp_planner", mcpPlannerSubgraph)
  .addNode("general_planner", generalPlannerSubgraph)
  .addNode("after_domain", afterDomain)
  .addNode("fallback_all", fallbackToAll)
  .addNode("all_planner", allPlannerSubgraph)
  .addEdge(START, "init_enabled")
  .addEdge("init_enabled", "select_domain")
  .addEdge("select_domain", "auto_parse")
  .addConditionalEdges("auto_parse", routeToDomainPlanner, {
    doc_planner: "doc_planner",
    kb_planner: "kb_planner",
    img_planner: "img_planner",
    code_planner: "code_planner",
    mcp_planner: "mcp_planner",
    general_planner: "general_planner",
    all_planner: "all_planner",
    __end__: END,
  })
  .addEdge("doc_planner", "after_domain")
  .addEdge("kb_planner", "after_domain")
  .addEdge("img_planner", "after_domain")
  .addEdge("code_planner", "after_domain")
  .addEdge("mcp_planner", "after_domain")
  .addEdge("general_planner", "after_domain")
  .addEdge("all_planner", "after_domain")
  .addConditionalEdges("after_domain", routeAfterDomain, {
    fallback_all: "fallback_all",
    __end__: END,
  })
  .addEdge("fallback_all", "all_planner")
  .compile({ checkpointer: false, name: "planner_agent" });

export async function runPlannerAgent(input: PlannerAgentInput): Promise<PlannerAgentOutput> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LangGraph invoke typing requires exact match
  const result = await plannerAgentGraph.invoke({
    userQuery: input.userQuery,
    messages: input.messages,
    projectKey: input.projectKey,
    docIds: input.docIds,
    attachments: input.attachments,
    skillHint: input.skillHint,
    llmConfig: input.llmConfig,
    traceContext: input.traceContext,
  } as any);

  const matchedSkillId = typeof result.matchedSkillId === "string" ? result.matchedSkillId : null;
  const skillArgs = (result.skillArgs && typeof result.skillArgs === "object")
    ? (result.skillArgs as Record<string, unknown>)
    : {};
  const skillDocIds = Array.isArray(result.skillDocIds)
    ? (result.skillDocIds as unknown[]).map((x) => String(x))
    : [];

  const sourceIntent = result.sourceIntent === "command" || result.sourceIntent === "keyword" || result.sourceIntent === "llm-tool"
    ? result.sourceIntent
    : "llm-tool";

  const respondText = typeof result.respondText === "string" && result.respondText.trim()
    ? result.respondText.trim()
    : undefined;

  return {
    matchedSkillId,
    skillArgs,
    skillDocIds,
    sourceIntent,
    ...(respondText ? { respondText } : {}),
  };
}
