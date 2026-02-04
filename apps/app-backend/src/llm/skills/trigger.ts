/**
 * Hybrid Trigger
 *
 * Analyzes user input and determines the appropriate trigger mode:
 * - "command": Explicit slash command (strong determinism)
 * - "anthropic": Matched Anthropic Skill by keywords (medium determinism)
 * - "natural": Natural language that may trigger a tool (LLM decides)
 * - "chat": Regular conversation (RAG-based response)
 */

import { skillRegistry, type OpenAITool } from "./registry.js";
import { skillConfigStore } from "./skill-config-store.js";
import type { SkillIntent } from "./types.js";
import type { UnifiedSkillDefinition } from "./adapters/types.js";
import type { SkillDefinition } from "./types.js";

/**
 * Trigger modes
 */
export type TriggerMode = "command" | "anthropic" | "natural" | "chat";

/**
 * Result of trigger analysis
 */
export type TriggerResult = {
  /** The determined trigger mode */
  mode: TriggerMode;
  /** Skill intent (only for command mode) */
  intent?: SkillIntent;
  /** Matched Anthropic Skill (only for anthropic mode) */
  anthropicSkill?: UnifiedSkillDefinition;
  /** User request for Anthropic Skill */
  userRequest?: string;
  /** OpenAI tools for LLM (only for natural mode) */
  tools?: OpenAITool[];
  /** System prompt for tool-aware LLM (only for natural mode) */
  toolSystemPrompt?: string;
};

// Command regex: matches /skill-name followed by optional arguments
const COMMAND_REGEX = /^\/([a-z]+-[a-z-]+)(?:\s+(.*))?$/;

/**
 * Analyze user input and determine trigger mode
 *
 * @param message - User's input message
 * @param docIds - Document IDs from @ mentions
 * @returns Trigger result with mode and associated data
 */
export async function analyzeTrigger(
  message: string,
  docIds?: string[],
): Promise<TriggerResult> {
  const trimmed = message.trim();

  const anthropicSkillInfos = await skillConfigStore.listAnthropicSkillInfo();
  const enabledAnthropicIds = new Set(
    anthropicSkillInfos.filter((s) => s.config.enabled).map((s) => s.skill.id),
  );

  // Path 1: Check for explicit slash command (strong determinism)
  const commandMatch = trimmed.match(COMMAND_REGEX);
  if (commandMatch) {
    const [, skillName, rest] = commandMatch;
    const command = `/${skillName}`;
    const skill = skillRegistry.getAnyByCommand(command);

    if (skill) {
      // Check if the skill is enabled
      const isNative = (skill as SkillDefinition).command !== undefined;
      const skillKey = isNative ? (skill as SkillDefinition).name : (skill as UnifiedSkillDefinition).id;
      const enabled = await skillConfigStore.isEnabled(skillKey);
      if (enabled) {
        console.log(`[Trigger] Command mode: ${command}`);
        if (isNative) {
          return {
            mode: "command",
            intent: buildIntent((skill as SkillDefinition).name, command, rest || "", message, docIds),
          };
        }
        return {
          mode: "anthropic",
          anthropicSkill: skill as UnifiedSkillDefinition,
          userRequest: rest || trimmed,
        };
      } else {
        console.log(`[Trigger] Skill ${skillKey} is disabled, falling through to natural mode`);
      }
    }
  }

  // Path 2: Check for Anthropic Skill keyword match (medium determinism)
  const anthropicSkill = matchAnthropicSkillByKeywords(trimmed, enabledAnthropicIds);
  if (anthropicSkill) {
    console.log(`[Trigger] Anthropic mode: matched skill "${anthropicSkill.name}"`);
    return {
      mode: "anthropic",
      anthropicSkill,
      userRequest: trimmed,
    };
  }

  // Path 3: Natural language mode - prepare tools for LLM
  const enabledNativeSkillNames = await skillConfigStore.getEnabledSkillNames();
  const enabledSkills = [...new Set([...enabledNativeSkillNames, ...Array.from(enabledAnthropicIds)])];
  const tools = skillRegistry.toOpenAITools(enabledSkills, true); // Include Anthropic Skills

  if (tools.length > 0) {
    console.log(`[Trigger] Natural mode with ${tools.length} tools available`);
    return {
      mode: "natural",
      tools,
      toolSystemPrompt: buildToolSystemPrompt(tools),
    };
  }

  // Path 4: Chat mode - no tools available
  console.log("[Trigger] Chat mode (no tools available)");
  return { mode: "chat" };
}

/**
 * Match Anthropic Skill by keywords in user message
 *
 * Returns the best matching skill if at least MIN_KEYWORD_MATCH keywords match.
 */
function matchAnthropicSkillByKeywords(
  message: string,
  enabledIds: Set<string>,
): UnifiedSkillDefinition | undefined {
  const MIN_KEYWORD_MATCH = 2;
  const lowerMessage = message.toLowerCase();

  let bestMatch: UnifiedSkillDefinition | undefined;
  let bestScore = 0;

  for (const skill of skillRegistry.getAllAnthropic()) {
    if (!enabledIds.has(skill.id)) continue;

    const keywords = skill.triggers.keywords || [];
    const matchCount = keywords.filter((kw) =>
      lowerMessage.includes(kw.toLowerCase()),
    ).length;

    if (matchCount >= MIN_KEYWORD_MATCH && matchCount > bestScore) {
      bestScore = matchCount;
      bestMatch = skill;
    }
  }

  return bestMatch;
}

/**
 * Build a skill intent from parsed command
 */
function buildIntent(
  skillName: string,
  command: string,
  rest: string,
  rawMessage: string,
  docIds?: string[],
): SkillIntent {
  const trimmedRest = rest.trim();
  const parentId = docIds && docIds.length > 0 ? docIds[0] : null;

  // Parse arguments based on skill type
  switch (skillName) {
    case "doc-create":
      return {
        skill: skillName,
        command,
        args: {
          title: trimmedRest || "新文档",
          description: trimmedRest,
          parent_id: parentId,
        },
        rawMessage,
        docIds,
      };

    case "doc-edit":
      return {
        skill: skillName,
        command,
        args: {
          instructions: trimmedRest,
        },
        rawMessage,
        docIds,
      };

    case "doc-read":
    case "doc-summary":
      return {
        skill: skillName,
        command,
        args: {},
        rawMessage,
        docIds,
      };

    case "doc-optimize-format":
    case "doc-optimize-content":
    case "doc-optimize-full":
      return {
        skill: skillName,
        command,
        args: trimmedRest ? { instructions: trimmedRest } : {},
        rawMessage,
        docIds,
      };

    case "doc-optimize-style": {
      const [style, ...instructionParts] = trimmedRest.split(/\s+/).filter(Boolean);
      return {
        skill: skillName,
        command,
        args: {
          style: style || "professional",
          ...(instructionParts.length > 0
            ? { instructions: instructionParts.join(" ") }
            : {}),
        },
        rawMessage,
        docIds,
      };
    }

    case "doc-move":
      return {
        skill: skillName,
        command,
        args: {
          target_parent_id: trimmedRest || "root",
        },
        rawMessage,
        docIds,
      };

    case "doc-delete":
      return {
        skill: skillName,
        command,
        args: {
          recursive: /\brecursive\b|\b递归\b/.test(trimmedRest),
        },
        rawMessage,
        docIds,
      };

    case "kb-search":
      return {
        skill: skillName,
        command,
        args: {
          query: trimmedRest,
        },
        rawMessage,
        docIds,
      };

    case "doc-fetch-url":
      return {
        skill: skillName,
        command,
        args: {
          url: trimmedRest,
        },
        rawMessage,
        docIds,
      };

    case "doc-import-git":
      return {
        skill: skillName,
        command,
        args: {
          repo_url: trimmedRest,
        },
        rawMessage,
        docIds,
      };

    case "doc-convert":
      return {
        skill: skillName,
        command,
        args: {
          from: "txt",
          to: "markdown",
          content: trimmedRest,
        },
        rawMessage,
        docIds,
      };

    default:
      // Generic fallback
      return {
        skill: skillName,
        command,
        args: { input: trimmedRest },
        rawMessage,
        docIds,
      };
  }
}

/**
 * Build system prompt for tool-aware LLM
 */
function buildToolSystemPrompt(tools: OpenAITool[]): string {
  const toolDescriptions = tools
    .map((t) => `- ${t.function.name}: ${t.function.description}`)
    .join("\n");

  return `你是 Zeus 文档管理系统的智能助手。

## 可用工具
你可以使用以下工具帮助用户完成文档操作：
${toolDescriptions}

## 使用规则
1. 当用户明确表达创建、编辑、读取、优化文档的意图时，选择合适的工具
2. 如果用户只是提问或闲聊，直接回答，不要使用工具
3. 使用工具时，确保从用户消息中提取必要的参数
4. 如果用户通过 @ 提到了文档，doc_id 参数已经在上下文中提供，你只需要调用工具

## 注意事项
- 对于 doc-create，title 是必需的，应该从用户描述中提取一个简洁的标题
- 对于 doc-edit，instructions 应该包含用户的完整修改要求
- 如果无法确定用户意图，直接回复而不使用工具`;
}

/**
 * Extract document IDs from tool call arguments
 * (used when LLM returns doc_id in arguments)
 */
export function extractDocIdsFromArgs(
  args: Record<string, unknown>,
  contextDocIds?: string[],
): string[] {
  // If doc_id is in args, use it
  if (args.doc_id && typeof args.doc_id === "string") {
    return [args.doc_id];
  }

  // Otherwise use context doc IDs
  return contextDocIds || [];
}
