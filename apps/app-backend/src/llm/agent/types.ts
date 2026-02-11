import type { TraceContext } from "../../observability/index.js";
import type { AnyZodObject } from "../zod.js";

export type AgentSkillSource = "native" | "anthropic" | "mcp" | "plugin";

export type AgentRiskLevel = "low" | "medium" | "high";

export type AgentExecutionMode = "native-handler" | "llm-guided" | "mcp-tool" | "plugin-worker";

// Zod-based schema for tool-call arguments.
// Conversion to OpenAI JSON schema happens at the catalog layer.
export type AgentInputSchema = AnyZodObject;

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
    requiresDocScope?: boolean;
  }>;
};
