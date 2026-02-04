import type { AgentSkillDefinition } from "./types.js";

type PolicyConfig = {
  allowShellExecution: boolean;
  allowMcpWrite: boolean;
};

const DEFAULT_CONFIG: PolicyConfig = {
  allowShellExecution: process.env.AGENT_ALLOW_SHELL === "true",
  allowMcpWrite: process.env.AGENT_ALLOW_MCP_WRITE === "true",
};

export class AgentPolicyEngine {
  private config: PolicyConfig;

  constructor(config: Partial<PolicyConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  shouldRequireConfirmation(skill: AgentSkillDefinition): boolean {
    return skill.risk.requireConfirmation;
  }

  canUseSkill(skill: AgentSkillDefinition): { allowed: boolean; reason?: string } {
    if (skill.source === "mcp") {
      const isWriteSkill = skill.capabilities.includes("mcp:write");
      if (isWriteSkill && !this.config.allowMcpWrite) {
        return {
          allowed: false,
          reason: "MCP write skills are disabled by policy",
        };
      }
    }
    return { allowed: true };
  }

  canExecuteShellCommands(): boolean {
    return this.config.allowShellExecution;
  }

  getConfig(): PolicyConfig {
    return { ...this.config };
  }
}

export const agentPolicyEngine = new AgentPolicyEngine();
