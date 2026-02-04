import type { McpToolDefinition } from "./mcp-client-manager.js";
import type { AgentSkillDefinition } from "./types.js";

function normalizeToolName(server: string, name: string): string {
  const raw = `mcp_${server}_${name}`.toLowerCase();
  return raw.replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_");
}

export function mcpToolToAgentSkill(tool: McpToolDefinition): AgentSkillDefinition {
  return {
    id: `mcp:${tool.id}`,
    source: "mcp",
    toolName: normalizeToolName(tool.server, tool.name),
    displayName: tool.name,
    description: tool.description,
    category: "mcp",
    inputSchema: tool.inputSchema,
    triggers: {
      keywords: [tool.name.toLowerCase(), tool.server.toLowerCase()],
      patterns: [],
    },
    risk: {
      level: tool.readOnly ? "low" : "high",
      requireConfirmation: !tool.readOnly,
      warningMessage: tool.readOnly
        ? undefined
        : "此 MCP 工具可能执行写操作，请确认后继续。",
    },
    executionMode: "mcp-tool",
    capabilities: tool.readOnly ? ["mcp:read"] : ["mcp:write"],
    enabledByDefault: tool.enabled !== false,
    priority: 80,
    metadata: {
      mcpToolId: tool.id,
      mcpServer: tool.server,
      mcpReadOnly: tool.readOnly,
    },
  };
}
