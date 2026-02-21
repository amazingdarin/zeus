import {
  Annotation,
  END,
  START,
  StateGraph,
} from "@langchain/langgraph";
import {
  agentPolicyEngine,
  agentSkillCatalog,
  normalizeAndValidateSkillArgs,
  type AgentRiskLevel,
  type AgentSkillDefinition,
} from "../../llm/agent/index.js";
import { zodObjectToOpenAIParameters } from "../../llm/zod.js";
import {
  buildMediaCandidateDescription,
  normalizeAssetIdList,
  readMediaCandidatesFromArgs,
  resolveCandidateKey,
  resolveCandidateKeys,
} from "../media-transcribe-context.js";
import { traceManager, type TraceContext } from "../../observability/index.js";

type PendingInputOption = {
  value: string;
  label: string;
  description?: string;
  meta?: Record<string, unknown>;
};

type PendingInputField = {
  key: string;
  type: string;
  description: string;
  enum?: string[];
  options?: PendingInputOption[];
  widget?: "select" | "choice_list";
};

export type DocAgentPendingRequiredInput =
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
      missing?: string[];
      issues?: Array<{ path: string; message: string }>;
      fields: PendingInputField[];
      currentArgs?: Record<string, unknown>;
    };

export type DocAgentPlan =
  | {
      action: "execute_skill";
      skillId: string;
      args: Record<string, unknown>;
      docIds: string[];
      sourceIntent: "command" | "keyword" | "llm-tool";
    }
  | { action: "respond_blocked"; reason: string }
  | { action: "respond_text"; text: string }
  | { action: "respond_error"; error: string };

export type DocAgentInput = {
  userId: string;
  matchedSkillId: string | null;
  skillArgs: Record<string, unknown>;
  skillDocIds: string[];
  sourceIntent: "command" | "keyword" | "llm-tool";
  fullAccess: boolean;
  traceContext?: TraceContext;
};

export type DocAgentOutput = {
  matchedSkillId: string | null;
  skillArgs: Record<string, unknown>;
  skillDocIds: string[];
  requiredInput: DocAgentPendingRequiredInput | null;
  needsConfirmation: boolean;
  plan: DocAgentPlan | null;
};

/** Helper: last-value reducer with a default. Required by @langchain/langgraph ^0.2 */
function lv<T>(defaultFn: () => T) {
  return { value: (_prev: T, next: T) => next, default: defaultFn };
}

const DocAgentGraphState = Annotation.Root({
  userId: Annotation<string>,
  matchedSkillId: Annotation<string | null>(lv<string | null>(() => null)),
  skillArgs: Annotation<Record<string, unknown>>(lv<Record<string, unknown>>(() => ({}))),
  skillDocIds: Annotation<string[]>(lv<string[]>(() => [])),
  sourceIntent: Annotation<"command" | "keyword" | "llm-tool">(
    lv<"command" | "keyword" | "llm-tool">(() => "command"),
  ),
  fullAccess: Annotation<boolean>(lv<boolean>(() => false)),

  requiredInput: Annotation<DocAgentPendingRequiredInput | null>(
    lv<DocAgentPendingRequiredInput | null>(() => null),
  ),
  needsConfirmation: Annotation<boolean>(lv<boolean>(() => false)),
  plan: Annotation<DocAgentPlan | null>(lv<DocAgentPlan | null>(() => null)),
});

type DocAgentState = typeof DocAgentGraphState.State;

function skillRequiresDocScope(skill: AgentSkillDefinition): boolean {
  return Boolean((skill.metadata as Record<string, unknown> | undefined)?.requiresDocScope);
}

function hasDocScope(args: Record<string, unknown>, docIds: string[]): boolean {
  if (docIds.length > 0) return true;
  const raw = args.doc_id;
  return typeof raw === "string" && raw.trim().length > 0;
}

function isMediaTranscribeSkill(skill: AgentSkillDefinition): boolean {
  const legacy = typeof skill.metadata?.legacySkillName === "string"
    ? skill.metadata.legacySkillName
    : "";
  return legacy === "media-transcribe";
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const normalized = normalizeString(item);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function normalizeTargetMode(value: unknown): "single" | "all" | "" {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === "single" || normalized === "all") return normalized;
  return "";
}

function hasMultipleDocumentCandidates(
  candidates: ReturnType<typeof readMediaCandidatesFromArgs>,
): boolean {
  const docIds = Array.from(
    new Set(candidates.map((candidate) => String(candidate.docId || "").trim()).filter(Boolean)),
  );
  return docIds.length > 1;
}

function buildTargetModeRequiredInput(
  skill: AgentSkillDefinition,
  currentArgs: Record<string, unknown>,
): DocAgentPendingRequiredInput | null {
  const candidates = readMediaCandidatesFromArgs(currentArgs);
  if (candidates.length <= 1) return null;

  return {
    kind: "skill_args",
    message: `检测到多个文档媒体候选，请先确认是转写单个媒体还是批量转写。\n${buildMediaCandidateDescription(candidates, 12)}`,
    skillName: skill.displayName,
    skillDescription: skill.description,
    missing: ["target_mode"],
    currentArgs,
    fields: [{
      key: "target_mode",
      type: "string",
      description: "选择 single（单个）或 all（批量）",
      enum: ["single", "all"],
      options: [
        {
          value: "single",
          label: "单个媒体",
          description: "先选一个媒体后执行",
        },
        {
          value: "all",
          label: "全部媒体",
          description: "对当前候选媒体全部转写",
        },
      ],
      widget: "choice_list",
    }],
  };
}

function buildCandidateSelectionRequiredInput(
  skill: AgentSkillDefinition,
  currentArgs: Record<string, unknown>,
): DocAgentPendingRequiredInput | null {
  const candidates = readMediaCandidatesFromArgs(currentArgs);
  if (candidates.length <= 1) return null;

  const options = candidates.slice(0, 50).map((candidate) => ({
    value: candidate.candidateKey,
    label: candidate.label,
    description: `${candidate.mediaKind}${candidate.docTitle ? ` / ${candidate.docTitle}` : ""}`,
    meta: {
      candidate_key: candidate.candidateKey,
      ...(candidate.docId ? { doc_id: candidate.docId } : {}),
      ...(candidate.blockId ? { block_id: candidate.blockId } : {}),
      media_kind: candidate.mediaKind,
    },
  }));

  if (options.length === 0) return null;

  return {
    kind: "skill_args",
    message: `检测到多个可转写媒体，请选择一个候选后继续。\n${buildMediaCandidateDescription(candidates, 12)}`,
    skillName: skill.displayName,
    skillDescription: skill.description,
    missing: ["candidate_key"],
    currentArgs,
    fields: [{
      key: "candidate_key",
      type: "string",
      description: "选择候选媒体（不会要求手动输入 asset_id）",
      enum: options.map((option) => option.value),
      options,
      widget: "choice_list",
    }],
  };
}

function normalizeMediaTranscribeArgs(
  skill: AgentSkillDefinition,
  rawArgs: Record<string, unknown>,
): { args: Record<string, unknown>; requiredInput: DocAgentPendingRequiredInput | null } {
  const args = { ...rawArgs };
  const rawAssetId = normalizeString(args.asset_id);
  const rawCandidateKey = normalizeString(args.candidate_key);
  const rawCandidateKeys = normalizeStringList(args.candidate_keys);
  const rawTargetMode = normalizeTargetMode(args.target_mode);
  const assetIds = normalizeAssetIdList(args.asset_ids);
  const candidates = readMediaCandidatesFromArgs(args);
  const candidateAssetIds = Array.from(
    new Set(candidates.map((candidate) => candidate.assetId).filter(Boolean)),
  );
  const selectedFromCandidateKey = resolveCandidateKey(args, rawCandidateKey);
  const selectedFromCandidateKeys = resolveCandidateKeys(args, rawCandidateKeys);
  const multiDocCandidates = hasMultipleDocumentCandidates(candidates);

  if (assetIds.length > 0) {
    args.asset_ids = assetIds;
  } else {
    delete args.asset_ids;
  }

  if (rawAssetId && rawAssetId !== "__ALL__") {
    args.asset_id = rawAssetId;
  } else if (rawAssetId !== "__ALL__") {
    delete args.asset_id;
  }

  if (rawCandidateKey) {
    args.candidate_key = rawCandidateKey;
  } else {
    delete args.candidate_key;
  }

  if (rawCandidateKeys.length > 0) {
    args.candidate_keys = rawCandidateKeys;
  } else {
    delete args.candidate_keys;
  }

  if (rawTargetMode) {
    args.target_mode = rawTargetMode;
  } else {
    delete args.target_mode;
  }

  if (selectedFromCandidateKey) {
    args.asset_id = selectedFromCandidateKey;
  }

  if (selectedFromCandidateKeys.length > 0) {
    args.asset_ids = Array.from(new Set([
      ...normalizeAssetIdList(args.asset_ids),
      ...selectedFromCandidateKeys,
    ]));
  }

  if (rawAssetId === "__ALL__") {
    args.target_mode = "all";
  }

  if (args.target_mode === "all") {
    const bulkAssetIds = selectedFromCandidateKeys.length > 0
      ? selectedFromCandidateKeys
      : candidateAssetIds;
    const merged = Array.from(new Set([...normalizeAssetIdList(args.asset_ids), ...bulkAssetIds]));
    if (merged.length === 0) {
      return {
        args,
        requiredInput: buildCandidateSelectionRequiredInput(skill, args),
      };
    }
    args.asset_ids = merged;
    delete args.asset_id;
    delete args.candidate_key;
    return { args, requiredInput: null };
  }

  if (!args.asset_id && !Array.isArray(args.asset_ids)) {
    if (candidateAssetIds.length === 1) {
      const onlyCandidate = candidates[0];
      if (onlyCandidate?.candidateKey) {
        args.candidate_key = onlyCandidate.candidateKey;
      }
      args.asset_id = candidateAssetIds[0];
      return { args, requiredInput: null };
    }
    if (candidateAssetIds.length > 1) {
      if (!args.target_mode && multiDocCandidates) {
        return {
          args,
          requiredInput: buildTargetModeRequiredInput(skill, args),
        };
      }
      return {
        args,
        requiredInput: buildCandidateSelectionRequiredInput(skill, args),
      };
    }
  }

  if (args.target_mode === "single" && !args.asset_id && candidateAssetIds.length > 1) {
    return {
      args,
      requiredInput: buildCandidateSelectionRequiredInput(skill, args),
    };
  }

  return { args, requiredInput: null };
}

async function validate(state: DocAgentState): Promise<Partial<DocAgentState>> {
  const skillId = state.matchedSkillId;
  if (!skillId) {
    return {
      requiredInput: null,
      needsConfirmation: false,
      plan: { action: "respond_error", error: "No skill resolved in doc_agent" },
    };
  }

  await agentSkillCatalog.initialize();
  const skill = agentSkillCatalog.getById(skillId, state.userId);
  if (!skill) {
    return {
      matchedSkillId: null,
      requiredInput: null,
      needsConfirmation: false,
      plan: { action: "respond_error", error: `Unknown skill: ${skillId}` },
    };
  }

  if (skillRequiresDocScope(skill) && !hasDocScope(state.skillArgs, state.skillDocIds)) {
    return {
      requiredInput: {
        kind: "doc_scope",
        message: "该操作需要指定文档。请选择要操作的文档后继续。",
        skillName: skill.displayName,
        skillDescription: skill.description,
      },
      needsConfirmation: false,
      plan: null,
    };
  }

  let normalizedInputArgs = state.skillArgs;
  if (isMediaTranscribeSkill(skill)) {
    const mediaAdjusted = normalizeMediaTranscribeArgs(skill, state.skillArgs);
    if (mediaAdjusted.requiredInput) {
      return {
        requiredInput: mediaAdjusted.requiredInput,
        skillArgs: mediaAdjusted.args,
        needsConfirmation: false,
        plan: null,
      };
    }
    normalizedInputArgs = mediaAdjusted.args;
  }

  const normalized = normalizeAndValidateSkillArgs(skill, normalizedInputArgs, state.skillDocIds);
  if (normalized.ok) {
    return {
      requiredInput: null,
      skillArgs: normalized.args,
      skillDocIds: normalized.docIds,
      plan: null,
    };
  }

  const { error } = normalized;
  const parameters = zodObjectToOpenAIParameters(skill.inputSchema);
  const props = parameters.properties || {};

  const keys: string[] = [];
  if (Array.isArray(error.missing) && error.missing.length > 0) {
    for (const k of error.missing) {
      if (k === "doc_id" && skillRequiresDocScope(skill)) continue;
      keys.push(k);
    }
  } else if (Array.isArray(error.issues) && error.issues.length > 0) {
    const set = new Set<string>();
    for (const issue of error.issues) {
      const first = issue.path ? issue.path.split(".")[0] : "";
      if (first) set.add(first);
    }
    keys.push(...Array.from(set));
  }

  if (keys.length === 0) {
    return {
      matchedSkillId: null,
      requiredInput: null,
      needsConfirmation: false,
      plan: { action: "respond_text", text: error.message || "参数校验失败，请重试。" },
    };
  }

  return {
    requiredInput: {
      kind: "skill_args",
      message: error.message || "请补充必要参数后继续。",
      skillName: skill.displayName,
      skillDescription: skill.description,
      missing: error.missing,
      issues: error.issues,
      currentArgs: normalizedInputArgs,
      fields: keys.slice(0, 12).map((key) => ({
        key,
        type: props[key]?.type || "string",
        description: props[key]?.description || key,
        enum: props[key]?.enum,
        options: undefined,
        widget: props[key]?.enum ? "select" : undefined,
      })),
    },
    needsConfirmation: false,
    plan: null,
  };
}

async function policy(state: DocAgentState): Promise<Partial<DocAgentState>> {
  if (state.requiredInput) {
    return {
      needsConfirmation: false,
      plan: null,
    };
  }

  if (state.plan) {
    // validation already produced an explicit response
    return {
      needsConfirmation: false,
      plan: state.plan,
    };
  }

  const skillId = state.matchedSkillId;
  if (!skillId) {
    return {
      needsConfirmation: false,
      plan: { action: "respond_error", error: "No skill resolved in doc_agent policy" },
    };
  }

  await agentSkillCatalog.initialize();
  const skill = agentSkillCatalog.getById(skillId, state.userId);
  if (!skill) {
    return {
      matchedSkillId: null,
      needsConfirmation: false,
      plan: { action: "respond_error", error: `Unknown skill: ${skillId}` },
    };
  }

  const policyResult = agentPolicyEngine.canUseSkill(skill);
  if (!policyResult.allowed) {
    return {
      needsConfirmation: false,
      plan: {
        action: "respond_blocked",
        reason: policyResult.reason || "操作被策略禁止",
      },
    };
  }

  const needsConfirm = state.fullAccess
    ? false
    : agentPolicyEngine.shouldRequireConfirmation(skill);

  if (needsConfirm) {
    return {
      needsConfirmation: true,
      plan: null,
    };
  }

  return {
    needsConfirmation: false,
    plan: {
      action: "execute_skill",
      skillId,
      args: state.skillArgs,
      docIds: state.skillDocIds,
      sourceIntent: state.sourceIntent,
    },
  };
}

export const docAgentGraph = new StateGraph(DocAgentGraphState)
  .addNode("validate", validate)
  .addNode("policy", policy)
  .addEdge(START, "validate")
  .addEdge("validate", "policy")
  .addEdge("policy", END)
  .compile({ checkpointer: false, name: "doc_agent" });

export async function runDocAgent(input: DocAgentInput): Promise<DocAgentOutput> {
  const span = input.traceContext
    ? traceManager.startSpan(input.traceContext, "agent.doc", {
        matchedSkillId: input.matchedSkillId,
        docIds: input.skillDocIds.length,
        sourceIntent: input.sourceIntent,
        fullAccess: input.fullAccess,
      })
    : null;
  const start = Date.now();

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LangGraph invoke typing requires exact match
    const result = await docAgentGraph.invoke({
      userId: input.userId,
      matchedSkillId: input.matchedSkillId,
      skillArgs: input.skillArgs,
      skillDocIds: input.skillDocIds,
      sourceIntent: input.sourceIntent,
      fullAccess: input.fullAccess,
    } as any);

    const matchedSkillId = typeof result.matchedSkillId === "string" ? result.matchedSkillId : null;
    const skillArgs = (result.skillArgs && typeof result.skillArgs === "object")
      ? (result.skillArgs as Record<string, unknown>)
      : {};
    const skillDocIds = Array.isArray(result.skillDocIds)
      ? (result.skillDocIds as unknown[]).map((x) => String(x))
      : [];

    const requiredInput = (result.requiredInput && typeof result.requiredInput === "object")
      ? (result.requiredInput as DocAgentPendingRequiredInput)
      : null;

    const needsConfirmation = Boolean(result.needsConfirmation);

    const plan = (result.plan && typeof result.plan === "object")
      ? (result.plan as DocAgentPlan)
      : null;

    if (span) {
      traceManager.endSpan(span, {
        matchedSkillId,
        needsConfirmation,
        requiredInput: Boolean(requiredInput),
        planAction: plan?.action,
        durationMs: Date.now() - start,
      });
    }

    return {
      matchedSkillId,
      skillArgs,
      skillDocIds,
      requiredInput,
      needsConfirmation,
      plan,
    };
  } catch (err) {
    if (span) {
      traceManager.endSpan(span, {
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      }, "ERROR");
    }
    throw err;
  }
}

// Future: Review hooks can live here without leaking into Supervisor Graph.
export type DocAgentRiskAssessment = {
  level: AgentRiskLevel;
  warningMessage?: string;
};
