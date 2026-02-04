import type { TraceContext } from "../../observability/index.js";

export type AgentSkillSource = "native" | "anthropic" | "mcp";

export type AgentRiskLevel = "low" | "medium" | "high";

export type AgentExecutionMode = "native-handler" | "llm-guided" | "mcp-tool";

export type AgentInputSchema = {
  type: "object";
  properties: Record<
    string,
    {
      type: string;
      description: string;
      enum?: string[];
      optional?: boolean;
    }
  >;
  required: string[];
};

export type AgentSkillDefinition = {
  id: string;
  source: AgentSkillSource;
  toolName: string;
  displayName: string;
  description: string;
  category: string;
  command?: string;
  inputSchema: AgentInputSchema;
  triggers: {
    command?: string;
    keywords?: string[];
    patterns?: string[];
  };
  risk: {
    level: AgentRiskLevel;
    requireConfirmation: boolean;
    warningMessage?: string;
  };
  executionMode: AgentExecutionMode;
  capabilities: string[];
  enabledByDefault: boolean;
  priority: number;
  metadata?: Record<string, unknown>;
};

export type AgentExecutionContext = {
  projectKey: string;
  sessionId?: string;
  docIds?: string[];
  userMessage: string;
  traceContext?: TraceContext;
  abortSignal?: AbortSignal;
};

export type AgentExecutionResult =
  | { type: "text"; content: string }
  | { type: "json"; data: Record<string, unknown> }
  | { type: "error"; message: string };

export type ProjectSkillConfig = {
  id: string;
  projectKey: string;
  skillId: string;
  source: AgentSkillSource;
  enabled: boolean;
  priority: number;
  riskOverride?: AgentRiskLevel | null;
  createdAt: string;
  updatedAt: string;
};

export type ProjectSkillCategory = {
  id: string;
  name: string;
  description: string;
  icon: string;
  skills: Array<{
    id: string;
    toolName: string;
    name: string;
    description: string;
    source: AgentSkillSource;
    enabled: boolean;
    priority: number;
    riskLevel: AgentRiskLevel;
    requireConfirmation: boolean;
    isConfigurable: boolean;
    command?: string;
  }>;
};

export type AgentPlan =
  | { mode: "chat" }
  | { mode: "llm_text"; text: string }
  | {
      mode: "execute";
      skill: AgentSkillDefinition;
      args: Record<string, unknown>;
      docIds: string[];
      sourceIntent: "command" | "anthropic-keyword" | "tool";
    };
