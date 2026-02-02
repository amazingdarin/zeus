/**
 * Hybrid Trigger
 *
 * Analyzes user input and determines the appropriate trigger mode:
 * - "command": Explicit slash command (strong determinism)
 * - "natural": Natural language that may trigger a tool (LLM decides)
 * - "chat": Regular conversation (RAG-based response)
 */

import { skillRegistry, type OpenAITool } from "./registry.js";
import { skillConfigStore } from "./skill-config-store.js";
import type { SkillIntent } from "./types.js";

/**
 * Trigger modes
 */
export type TriggerMode = "command" | "natural" | "chat";

/**
 * Result of trigger analysis
 */
export type TriggerResult = {
  /** The determined trigger mode */
  mode: TriggerMode;
  /** Skill intent (only for command mode) */
  intent?: SkillIntent;
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

  // Path 1: Check for explicit slash command (strong determinism)
  const commandMatch = trimmed.match(COMMAND_REGEX);
  if (commandMatch) {
    const [, skillName, rest] = commandMatch;
    const command = `/${skillName}`;
    const skill = skillRegistry.getByCommand(command);

    if (skill) {
      // Check if the skill is enabled
      const enabled = await skillConfigStore.isEnabled(skill.name);
      if (enabled) {
        console.log(`[Trigger] Command mode: ${command}`);
        return {
          mode: "command",
          intent: buildIntent(skill.name, command, rest || "", message, docIds),
        };
      } else {
        console.log(`[Trigger] Skill ${skill.name} is disabled, falling through to natural mode`);
      }
    }
  }

  // Path 2: Natural language mode - prepare tools for LLM
  const enabledSkillNames = await skillConfigStore.getEnabledSkillNames();
  const tools = skillRegistry.toOpenAITools(enabledSkillNames);

  if (tools.length > 0) {
    console.log(`[Trigger] Natural mode with ${tools.length} tools available`);
    return {
      mode: "natural",
      tools,
      toolSystemPrompt: buildToolSystemPrompt(tools),
    };
  }

  // Path 3: Chat mode - no tools available
  console.log("[Trigger] Chat mode (no tools available)");
  return { mode: "chat" };
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
    case "doc-optimize-format":
    case "doc-optimize-content":
      return {
        skill: skillName,
        command,
        args: {},
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
