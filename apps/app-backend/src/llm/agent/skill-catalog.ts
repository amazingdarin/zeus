import { z } from "zod";
import type { PluginRegisteredCommandV2 } from "@zeus/plugin-sdk-shared";

import { documentSkills } from "../skills/document-skills.js";
import { skillRegistry, type OpenAITool } from "../skills/registry.js";
import type { SkillDefinition } from "../skills/types.js";
import type { UnifiedSkillDefinition } from "../skills/adapters/types.js";
import { zodObjectHasRequiredKey, zodObjectToOpenAIParameters } from "../zod.js";
import { pluginManagerV2 } from "../../plugins-v2/index.js";
import { mcpClientManager } from "./mcp-client-manager.js";
import { mcpToolToAgentSkill } from "./mcp-skill-adapter.js";
import type { AgentSkillDefinition } from "./types.js";

function normalizeToolName(source: string, name: string): string {
  const raw = `${source}_${name}`.toLowerCase();
  return raw.replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_");
}

function nativeToAgentSkill(skill: SkillDefinition): AgentSkillDefinition {
  return {
    id: `native:${skill.name}`,
    source: "native",
    toolName: normalizeToolName("native", skill.name.replace(/-/g, "_")),
    displayName: skill.name,
    description: skill.description,
    category: skill.category,
    command: skill.command,
    inputSchema: skill.inputSchema,
    triggers: {
      command: skill.command,
      keywords: skill.description
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length >= 3)
        .slice(0, 12),
    },
    risk: {
      level: skill.confirmation?.riskLevel || "medium",
      requireConfirmation: skill.confirmation?.required === true,
      warningMessage: skill.confirmation?.warningMessage,
    },
    executionMode: "native-handler",
    capabilities: ["native"],
    enabledByDefault: true,
    priority: 10,
    metadata: {
      legacySkillName: skill.name,
      legacyCommand: skill.command,
      legacySource: "native",
      requiresDocScope: zodObjectHasRequiredKey(skill.inputSchema, "doc_id"),
    },
  };
}

function anthropicToAgentSkill(skill: UnifiedSkillDefinition): AgentSkillDefinition {
  const inputSchema = skill.inputSchema || z.object({
    request: z.string().describe("User request for this skill"),
    context: z.string().describe("Optional context for this skill").optional(),
  });

  const hasScript = (skill.resources || []).some((r) => r.type === "script");

  return {
    id: skill.id,
    source: "anthropic",
    toolName: normalizeToolName("anthropic", skill.name.replace(/-/g, "_")),
    displayName: skill.name,
    description: skill.description,
    category: skill.category || "general",
    command: skill.triggers.command,
    inputSchema,
    triggers: {
      command: skill.triggers.command,
      keywords: skill.triggers.keywords || [],
      patterns: skill.triggers.patterns || [],
    },
    risk: {
      level: hasScript ? "high" : "medium",
      requireConfirmation: hasScript,
      warningMessage: hasScript
        ? "该技能可能执行脚本，默认策略会阻止命令执行。"
        : undefined,
    },
    executionMode: "llm-guided",
    capabilities: hasScript ? ["anthropic", "script"] : ["anthropic"],
    enabledByDefault: skill.enabled,
    priority: skill.priority,
    metadata: {
      legacySkillId: skill.id,
      legacySkillName: skill.name,
      sourcePath: skill.sourcePath,
      requiresDocScope: zodObjectHasRequiredKey(inputSchema, "doc_id"),
    },
  };
}

function pluginCommandToAgentSkill(
  command: PluginRegisteredCommandV2,
): AgentSkillDefinition {
  const pluginId = String(command.pluginId || "").trim();
  const commandId = String(command.commandId || "").trim();
  const handler = String(command.handler || commandId).trim();
  const commandName = Array.isArray(command.slashAliases)
    ? String(command.slashAliases[0] || "").trim()
    : "";
  const requiresDocScope = command.requiresDocScope === true;

  const inputSchema = requiresDocScope
    ? z.object({ doc_id: z.string().min(1) }).catchall(z.unknown())
    : z.object({ doc_id: z.string().min(1).optional() }).catchall(z.unknown());

  const displayName = String(command.title || commandName || commandId || pluginId).trim();
  const description = String(command.description || displayName).trim();
  const id = `plugin:${pluginId}:${commandId}`;
  const toolName = normalizeToolName("plugin", `${pluginId}_${commandId}`);

  return {
    id,
    source: "plugin",
    toolName,
    displayName,
    description,
    category: String(command.category || "plugin").trim() || "plugin",
    command: commandName || undefined,
    inputSchema,
    triggers: {
      command: commandName || undefined,
      keywords: [],
      patterns: [],
    },
    risk: {
      level: "medium",
      requireConfirmation: false,
    },
    executionMode: "plugin-worker",
    capabilities: ["plugin", "system.command.register"],
    enabledByDefault: true,
    priority: 500,
    metadata: {
      pluginId,
      commandId,
      operationId: handler,
      command: commandName,
      slashAliases: command.slashAliases || [],
      requiresDocScope,
    },
  };
}

class AgentSkillCatalog {
  private byId = new Map<string, AgentSkillDefinition>();
  private byToolName = new Map<string, string>();
  private byCommand = new Map<string, string>();
  private pluginByUser = new Map<string, AgentSkillDefinition[]>();
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await mcpClientManager.initialize();
    this.rebuild();
    mcpClientManager.on("updated", () => {
      this.rebuild();
    });
    this.initialized = true;
  }

  async refreshPluginSkillsForUser(userId: string): Promise<void> {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) {
      return;
    }
    const commands = await pluginManagerV2.listEnabledCommandsForUser(normalizedUserId);
    const skills = commands
      .map(pluginCommandToAgentSkill)
      .sort((a, b) => {
        const left = a.command || a.id;
        const right = b.command || b.id;
        return left.localeCompare(right);
      });
    this.pluginByUser.set(normalizedUserId, skills);
  }

  rebuild(): void {
    const nativeSkills = documentSkills.map(nativeToAgentSkill);
    const anthropicSkills = skillRegistry
      .getAllAnthropic()
      .map(anthropicToAgentSkill);
    const mcpSkills = mcpClientManager.listTools().map(mcpToolToAgentSkill);

    this.byId.clear();
    this.byToolName.clear();
    this.byCommand.clear();

    for (const skill of [...nativeSkills, ...anthropicSkills, ...mcpSkills]) {
      if (this.byId.has(skill.id)) {
        console.warn(`[AgentSkillCatalog] Duplicate skill id skipped: ${skill.id}`);
        continue;
      }
      if (this.byToolName.has(skill.toolName)) {
        console.warn(`[AgentSkillCatalog] Duplicate tool name skipped: ${skill.toolName}`);
        continue;
      }
      this.byId.set(skill.id, skill);
      this.byToolName.set(skill.toolName, skill.id);
      if (skill.command) {
        this.byCommand.set(skill.command, skill.id);
      }
    }
  }

  private resolveSkills(userId?: string): AgentSkillDefinition[] {
    this.rebuild();
    const base = Array.from(this.byId.values());
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) {
      return base;
    }
    const pluginSkills = this.pluginByUser.get(normalizedUserId) || [];
    return [...base, ...pluginSkills];
  }

  getAllSkills(userId?: string): AgentSkillDefinition[] {
    return this.resolveSkills(userId);
  }

  getById(skillId: string, userId?: string): AgentSkillDefinition | undefined {
    const all = this.resolveSkills(userId);
    return all.find((skill) => skill.id === skillId);
  }

  getByToolName(toolName: string, userId?: string): AgentSkillDefinition | undefined {
    const all = this.resolveSkills(userId);
    return all.find((skill) => skill.toolName === toolName);
  }

  getByCommand(command: string, userId?: string): AgentSkillDefinition | undefined {
    const all = this.resolveSkills(userId);
    return all.find((skill) => skill.command === command);
  }

  matchAnthropicByKeywords(
    message: string,
    enabledSkillIds?: Set<string>,
    userId?: string,
  ): AgentSkillDefinition | undefined {
    const lowerMessage = message.toLowerCase();
    let best: AgentSkillDefinition | undefined;
    let bestScore = 0;
    const all = this.resolveSkills(userId);

    for (const skill of all) {
      if (skill.source !== "anthropic") continue;
      if (enabledSkillIds && !enabledSkillIds.has(skill.id)) continue;

      const keywords = skill.triggers.keywords || [];
      const matchCount = keywords.filter((kw) =>
        lowerMessage.includes(kw.toLowerCase()),
      ).length;
      if (matchCount >= 2 && matchCount > bestScore) {
        best = skill;
        bestScore = matchCount;
      }
    }

    return best;
  }

  toOpenAITools(enabledSkillIds?: Set<string>, userId?: string): OpenAITool[] {
    const all = this.resolveSkills(userId);
    const tools: OpenAITool[] = [];
    for (const skill of all) {
      if (enabledSkillIds && !enabledSkillIds.has(skill.id)) continue;
      const parameters = zodObjectToOpenAIParameters(skill.inputSchema);
      tools.push({
        type: "function",
        function: {
          name: skill.toolName,
          description: skill.description,
          parameters,
        },
      });
    }
    return tools;
  }

  getCounts(userId?: string): { native: number; anthropic: number; mcp: number; plugin: number; total: number } {
    const all = this.resolveSkills(userId);
    let native = 0;
    let anthropic = 0;
    let mcp = 0;
    let plugin = 0;

    for (const skill of all) {
      if (skill.source === "native") native += 1;
      if (skill.source === "anthropic") anthropic += 1;
      if (skill.source === "mcp") mcp += 1;
      if (skill.source === "plugin") plugin += 1;
    }

    return {
      native,
      anthropic,
      mcp,
      plugin,
      total: native + anthropic + mcp + plugin,
    };
  }
}

export const agentSkillCatalog = new AgentSkillCatalog();
