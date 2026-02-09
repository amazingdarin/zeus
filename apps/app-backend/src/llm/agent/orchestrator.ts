import { llmGateway, type ProviderConfigInternal } from "../index.js";
import { extractDocIdsFromArgs } from "../skills/trigger.js";
import { agentSkillCatalog } from "./skill-catalog.js";
import { projectSkillConfigStore } from "./project-skill-config-store.js";
import type { AgentPlan, AgentSkillDefinition } from "./types.js";

type OrchestratorMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type OrchestratorPlanInput = {
  projectKey: string;
  userMessage: string;
  messages: OrchestratorMessage[];
  docIds?: string[];
  llmConfig: ProviderConfigInternal | null;
  traceContext?: import("../../observability/index.js").TraceContext;
};

const COMMAND_REGEX = /^\/([a-z]+-[a-z-]+)(?:\s+(.*))?$/;

function buildToolSystemPrompt(tools: string[]): string {
  return `你是 Zeus System Agent。

你可以选择并调用技能来完成用户任务。请优先调用最匹配的单个技能。

可用技能:
${tools.map((name) => `- ${name}`).join("\n")}

规则:
1. 只有在任务明确时才调用技能
2. 参数尽量从用户消息中完整提取
3. 如果没有合适技能，直接回答文本`;
}

function buildCommandArgs(
  skill: AgentSkillDefinition,
  rest: string,
  docIds?: string[],
): Record<string, unknown> {
  const trimmed = rest.trim();
  const firstDocId = docIds && docIds.length > 0 ? docIds[0] : undefined;
  const legacy = typeof skill.metadata?.legacySkillName === "string"
    ? skill.metadata.legacySkillName
    : "";

  switch (legacy) {
    case "doc-create":
      return {
        title: trimmed || "新文档",
        description: trimmed,
        parent_id: firstDocId || null,
      };
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
      const [style, ...instructionParts] = trimmed.split(/\s+/).filter(Boolean);
      return {
        style: style || "professional",
        ...(instructionParts.length > 0
          ? { instructions: instructionParts.join(" ") }
          : {}),
      };
    }
    case "doc-delete":
      return {
        doc_id: firstDocId,
        recursive: /\brecursive\b|\b递归\b/.test(trimmed),
      };
    case "doc-move":
      return {
        doc_id: firstDocId,
        target_parent_id: trimmed || "root",
      };
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
    default:
      if (skill.source === "anthropic") {
        return {
          request: trimmed || rest,
        };
      }
      return { input: trimmed };
  }
}

export class AgentOrchestrator {
  async plan(input: OrchestratorPlanInput): Promise<AgentPlan> {
    await agentSkillCatalog.initialize();

    const allSkills = agentSkillCatalog.getAllSkills();
    const enabledSkillIds = new Set(
      await projectSkillConfigStore.getEnabledSkillIds(input.projectKey, allSkills),
    );

    const trimmed = input.userMessage.trim();

    // 1) Explicit command
    const commandMatch = trimmed.match(COMMAND_REGEX);
    if (commandMatch) {
      const [, commandName, rest = ""] = commandMatch;
      const command = `/${commandName}`;
      const skill = agentSkillCatalog.getByCommand(command);
      if (skill && !enabledSkillIds.has(skill.id)) {
        return {
          mode: "blocked",
          reason: `技能 ${command} 已被禁用，请在项目技能设置中启用后再试。`,
          command,
        };
      }
      if (skill) {
        return {
          mode: "execute",
          skill,
          args: buildCommandArgs(skill, rest, input.docIds),
          docIds: input.docIds || [],
          sourceIntent: "command",
        };
      }
    }

    // 2) Anthropic keyword shortcut
    const keywordMatched = agentSkillCatalog.matchAnthropicByKeywords(trimmed, enabledSkillIds);
    if (keywordMatched) {
      return {
        mode: "execute",
        skill: keywordMatched,
        args: { request: trimmed },
        docIds: input.docIds || [],
        sourceIntent: "anthropic-keyword",
      };
    }

    // 3) Natural mode with tool selection
    if (!input.llmConfig?.enabled || !input.llmConfig.defaultModel) {
      return { mode: "chat" };
    }

    const tools = agentSkillCatalog.toOpenAITools(enabledSkillIds);
    if (tools.length === 0) {
      return { mode: "chat" };
    }

    const systemPrompt = buildToolSystemPrompt(tools.map((t) => t.function.name));
    const messages = [
      { role: "system" as const, content: systemPrompt },
      ...input.messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    if (input.docIds && input.docIds.length > 0) {
      messages.push({
        role: "system",
        content: `Context document IDs: ${input.docIds.join(", ")}`,
      });
    }

    const response = await llmGateway.chatWithTools({
      provider: input.llmConfig.providerId,
      model: input.llmConfig.defaultModel,
      baseUrl: input.llmConfig.baseUrl,
      apiKey: input.llmConfig.apiKey,
      messages,
      tools,
      tool_choice: "auto",
      traceContext: input.traceContext,
    });

    if (response.toolCalls && response.toolCalls.length > 0) {
      const first = response.toolCalls[0];
      const skill = agentSkillCatalog.getByToolName(first.function.name);
      if (!skill) {
        return response.content
          ? { mode: "llm_text", text: response.content }
          : { mode: "chat" };
      }

      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(first.function.arguments);
      } catch {
        args = {};
      }

      return {
        mode: "execute",
        skill,
        args,
        docIds: extractDocIdsFromArgs(args, input.docIds),
        sourceIntent: "tool",
      };
    }

    if (response.content && response.content.trim()) {
      return { mode: "llm_text", text: response.content };
    }

    return { mode: "chat" };
  }
}

export const agentOrchestrator = new AgentOrchestrator();
