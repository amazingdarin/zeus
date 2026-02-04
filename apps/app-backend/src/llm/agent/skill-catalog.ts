import { documentSkills } from "../skills/document-skills.js";
import { skillRegistry, type OpenAITool } from "../skills/registry.js";
import type { SkillDefinition } from "../skills/types.js";
import type { UnifiedSkillDefinition } from "../skills/adapters/types.js";
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
    inputSchema: {
      type: "object",
      properties: skill.parameters.properties,
      required: skill.parameters.required,
    },
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
      requiresDocScope: skill.parameters.required.includes("doc_id"),
    },
  };
}

function anthropicToAgentSkill(skill: UnifiedSkillDefinition): AgentSkillDefinition {
  const params = skill.parameters || {
    type: "object" as const,
    properties: {
      request: {
        type: "string",
        description: "User request for this skill",
      },
      context: {
        type: "string",
        description: "Optional context for this skill",
        optional: true,
      },
    },
    required: ["request"],
  };

  const hasScript = (skill.resources || []).some((r) => r.type === "script");

  return {
    id: skill.id,
    source: "anthropic",
    toolName: normalizeToolName("anthropic", skill.name.replace(/-/g, "_")),
    displayName: skill.name,
    description: skill.description,
    category: skill.category || "general",
    command: skill.triggers.command,
    inputSchema: {
      type: "object",
      properties: params.properties,
      required: params.required,
    },
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
    },
  };
}

class AgentSkillCatalog {
  private byId = new Map<string, AgentSkillDefinition>();
  private byToolName = new Map<string, string>();
  private byCommand = new Map<string, string>();
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

  getAllSkills(): AgentSkillDefinition[] {
    this.rebuild();
    return Array.from(this.byId.values());
  }

  getById(skillId: string): AgentSkillDefinition | undefined {
    this.rebuild();
    return this.byId.get(skillId);
  }

  getByToolName(toolName: string): AgentSkillDefinition | undefined {
    this.rebuild();
    const id = this.byToolName.get(toolName);
    return id ? this.byId.get(id) : undefined;
  }

  getByCommand(command: string): AgentSkillDefinition | undefined {
    this.rebuild();
    const id = this.byCommand.get(command);
    return id ? this.byId.get(id) : undefined;
  }

  matchAnthropicByKeywords(
    message: string,
    enabledSkillIds?: Set<string>,
  ): AgentSkillDefinition | undefined {
    this.rebuild();
    const lowerMessage = message.toLowerCase();
    let best: AgentSkillDefinition | undefined;
    let bestScore = 0;

    for (const skill of this.byId.values()) {
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

  toOpenAITools(enabledSkillIds?: Set<string>): OpenAITool[] {
    this.rebuild();
    const tools: OpenAITool[] = [];
    for (const skill of this.byId.values()) {
      if (enabledSkillIds && !enabledSkillIds.has(skill.id)) continue;
      tools.push({
        type: "function",
        function: {
          name: skill.toolName,
          description: skill.description,
          parameters: {
            type: "object",
            properties: Object.fromEntries(
              Object.entries(skill.inputSchema.properties).map(([k, v]) => [
                k,
                {
                  type: v.type,
                  description: v.description,
                  ...(v.enum ? { enum: v.enum } : {}),
                },
              ]),
            ),
            required: skill.inputSchema.required,
          },
        },
      });
    }
    return tools;
  }

  getCounts(): { native: number; anthropic: number; mcp: number; total: number } {
    this.rebuild();
    let native = 0;
    let anthropic = 0;
    let mcp = 0;
    for (const skill of this.byId.values()) {
      if (skill.source === "native") native += 1;
      if (skill.source === "anthropic") anthropic += 1;
      if (skill.source === "mcp") mcp += 1;
    }
    return {
      native,
      anthropic,
      mcp,
      total: native + anthropic + mcp,
    };
  }
}

export const agentSkillCatalog = new AgentSkillCatalog();
