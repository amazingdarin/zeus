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
      fields: Array<{
        key: string;
        type: string;
        description: string;
        enum?: string[];
      }>;
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
  matchedSkillId: string | null;
  skillArgs: Record<string, unknown>;
  skillDocIds: string[];
  sourceIntent: "command" | "keyword" | "llm-tool";
  fullAccess: boolean;
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
  const skill = agentSkillCatalog.getById(skillId);
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

  const normalized = normalizeAndValidateSkillArgs(skill, state.skillArgs, state.skillDocIds);
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
      currentArgs: state.skillArgs,
      fields: keys.slice(0, 12).map((key) => ({
        key,
        type: props[key]?.type || "string",
        description: props[key]?.description || key,
        enum: props[key]?.enum,
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
  const skill = agentSkillCatalog.getById(skillId);
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LangGraph invoke typing requires exact match
  const result = await docAgentGraph.invoke({
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

  return {
    matchedSkillId,
    skillArgs,
    skillDocIds,
    requiredInput,
    needsConfirmation,
    plan,
  };
}

// Future: Review hooks can live here without leaking into Supervisor Graph.
export type DocAgentRiskAssessment = {
  level: AgentRiskLevel;
  warningMessage?: string;
};

