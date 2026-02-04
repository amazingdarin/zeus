import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";

export type McpToolDefinition = {
  id: string;
  name: string;
  description: string;
  server: string;
  readOnly: boolean;
  inputSchema: {
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
  enabled?: boolean;
};

type McpExecutionResult = {
  success: boolean;
  output?: string;
  error?: string;
};

export interface McpManagerEvents {
  updated: (tools: McpToolDefinition[]) => void;
}

export class McpClientManager extends EventEmitter {
  private tools = new Map<string, McpToolDefinition>();
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    const loaded = await this.loadFromConfig();
    this.tools.clear();
    loaded.forEach((tool) => this.tools.set(tool.id, tool));
    this.initialized = true;
    this.emit("updated", this.listTools());
  }

  listTools(): McpToolDefinition[] {
    return Array.from(this.tools.values()).filter((t) => t.enabled !== false);
  }

  getTool(id: string): McpToolDefinition | undefined {
    return this.tools.get(id);
  }

  getCounts(): { total: number; readOnly: number; writable: number } {
    let readOnly = 0;
    let writable = 0;
    for (const tool of this.tools.values()) {
      if (tool.readOnly) {
        readOnly += 1;
      } else {
        writable += 1;
      }
    }
    return {
      total: this.tools.size,
      readOnly,
      writable,
    };
  }

  async executeTool(
    toolId: string,
    _args: Record<string, unknown>,
  ): Promise<McpExecutionResult> {
    const tool = this.tools.get(toolId);
    if (!tool) {
      return { success: false, error: `MCP tool not found: ${toolId}` };
    }

    // The runtime intentionally does not execute arbitrary third-party MCP actions by default.
    // Real MCP remote execution can be added behind AGENT_ENABLE_MCP_RUNTIME in the future.
    if (process.env.AGENT_ENABLE_MCP_RUNTIME !== "true") {
      return {
        success: false,
        error:
          `MCP runtime is disabled. Tool "${tool.name}" is discoverable but not executable in this deployment.`,
      };
    }

    return {
      success: false,
      error: "MCP runtime is enabled but no transport implementation is configured",
    };
  }

  private async loadFromConfig(): Promise<McpToolDefinition[]> {
    const toolsFromEnv = process.env.MCP_TOOLS_JSON;
    if (toolsFromEnv && toolsFromEnv.trim()) {
      return this.parseTools(toolsFromEnv);
    }

    const toolsFile = process.env.MCP_TOOLS_FILE;
    if (toolsFile && toolsFile.trim()) {
      const content = await readFile(toolsFile, "utf-8");
      return this.parseTools(content);
    }

    return [];
  }

  private parseTools(raw: string): McpToolDefinition[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.warn("[McpClientManager] Failed to parse MCP tools JSON:", err);
      return [];
    }

    if (!Array.isArray(parsed)) {
      return [];
    }

    const result: McpToolDefinition[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const id = String(record.id || "").trim();
      const name = String(record.name || "").trim();
      const description = String(record.description || "").trim();
      const server = String(record.server || "external").trim();

      if (!id || !name || !description) continue;

      const inputSchema = this.normalizeSchema(record.inputSchema);
      result.push({
        id,
        name,
        description,
        server,
        readOnly: record.readOnly !== false,
        inputSchema,
        enabled: record.enabled !== false,
      });
    }
    return result;
  }

  private normalizeSchema(raw: unknown): McpToolDefinition["inputSchema"] {
    if (!raw || typeof raw !== "object") {
      return {
        type: "object",
        properties: {},
        required: [],
      };
    }

    const schema = raw as {
      type?: string;
      properties?: Record<string, unknown>;
      required?: unknown;
    };

    const properties: McpToolDefinition["inputSchema"]["properties"] = {};
    for (const [key, value] of Object.entries(schema.properties || {})) {
      if (!value || typeof value !== "object") continue;
      const prop = value as Record<string, unknown>;
      properties[key] = {
        type: String(prop.type || "string"),
        description: String(prop.description || key),
        enum: Array.isArray(prop.enum)
          ? prop.enum.map((v) => String(v))
          : undefined,
        optional: prop.optional === true,
      };
    }

    return {
      type: "object",
      properties,
      required: Array.isArray(schema.required)
        ? schema.required.map((v) => String(v))
        : [],
    };
  }
}

export const mcpClientManager = new McpClientManager();
