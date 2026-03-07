import { randomUUID } from "node:crypto";

import { traceManager } from "../observability/index.js";
import {
  McpJsonRpcError,
  McpToolExecutionError,
  type JsonRpcErrorResponse,
  type JsonRpcId,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type JsonRpcSuccessResponse,
  type McpRequestContext,
  type McpServerConfig,
  type McpToolDefinition,
} from "./types.js";

type SessionState = {
  id: string;
  userId: string;
  initialized: boolean;
  createdAt: number;
  lastSeenAt: number;
};

const SUPPORTED_PROTOCOL_VERSION = "2025-06-18";

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asJsonRpcSuccess(id: JsonRpcId, result: unknown): JsonRpcSuccessResponse {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

function sanitizeErrorData(data: unknown): unknown {
  if (!data || typeof data !== "object") return data;
  if (Array.isArray(data)) return data.slice(0, 10);
  const record = data as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (["authorization", "token", "jwt", "secret"].includes(key.toLowerCase())) {
      continue;
    }
    next[key] = value;
  }
  return next;
}

export class ZeusMcpServer {
  private readonly tools = new Map<string, McpToolDefinition>();
  private readonly sessions = new Map<string, SessionState>();

  constructor(
    _config: McpServerConfig,
    toolDefinitions: McpToolDefinition[],
  ) {
    for (const tool of toolDefinitions) {
      this.tools.set(tool.name, tool);
    }
  }

  listTools(): McpToolDefinition[] {
    return Array.from(this.tools.values()).filter((tool) => tool.enabled);
  }

  hasSession(sessionId: string | undefined): boolean {
    if (!sessionId) return false;
    return this.sessions.has(sessionId);
  }

  canUseSession(sessionId: string | undefined, userId: string): boolean {
    if (!sessionId) return false;
    const session = this.sessions.get(sessionId);
    return Boolean(session && session.userId === userId);
  }

  async handleRequest(
    rawRequest: unknown,
    context: McpRequestContext,
  ): Promise<JsonRpcResponse | null> {
    const traceId = `mcp-${randomUUID()}`;
    const traceContext = traceManager.startTrace(traceId, {
      name: "mcp.request",
      userId: context.user.id,
      tags: ["mcp"],
      metadata: {
        sessionId: context.sessionId,
      },
    });
    const requestSpan = traceManager.startSpan(traceContext, "mcp.request", rawRequest);

    try {
      const request = this.parseRequest(rawRequest);
      const id: JsonRpcId = request.id ?? null;
      const method = request.method;

      let result: unknown;
      switch (method) {
        case "initialize":
          result = this.handleInitialize(context);
          break;
        case "notifications/initialized":
          this.requireSession(context);
          this.markSessionInitialized(context.sessionId!);
          result = {};
          break;
        case "ping":
          this.requireSession(context);
          result = {};
          break;
        case "tools/list":
          this.requireSession(context);
          result = {
            tools: this.listTools().map((tool) => ({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema,
              annotations: {
                readOnlyHint: tool.readOnly,
              },
            })),
          };
          break;
        case "tools/call":
          this.requireSession(context);
          result = await this.handleToolCall(request, context, traceContext.traceId);
          break;
        default:
          throw new McpJsonRpcError(-32601, `Method not found: ${method}`);
      }

      traceManager.endSpan(requestSpan, { method, ok: true });
      traceManager.endTrace(traceId);

      if (request.id === undefined) {
        return null;
      }
      return asJsonRpcSuccess(id, result);
    } catch (err) {
      const response = this.toErrorResponse(
        isObjectRecord(rawRequest) && "id" in rawRequest
          ? (rawRequest as { id?: JsonRpcId }).id ?? null
          : null,
        err,
      );
      traceManager.endSpan(
        requestSpan,
        {
          ok: false,
          error: response.error.message,
          code: response.error.code,
        },
        "ERROR",
      );
      traceManager.endTrace(traceId, response.error);
      return response;
    }
  }

  private parseRequest(raw: unknown): JsonRpcRequest {
    if (!isObjectRecord(raw)) {
      throw new McpJsonRpcError(-32600, "Invalid request");
    }
    const jsonrpc = String(raw.jsonrpc ?? "");
    const method = String(raw.method ?? "");
    if (jsonrpc !== "2.0" || !method) {
      throw new McpJsonRpcError(-32600, "Invalid request");
    }
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      method,
    };
    if ("id" in raw) {
      request.id = raw.id as JsonRpcId;
    }
    if ("params" in raw) {
      request.params = raw.params;
    }
    return request;
  }

  private handleInitialize(context: McpRequestContext): Record<string, unknown> {
    const sessionId = randomUUID();
    const now = Date.now();
    const session: SessionState = {
      id: sessionId,
      userId: context.user.id,
      initialized: false,
      createdAt: now,
      lastSeenAt: now,
    };
    this.sessions.set(sessionId, session);
    context.setSessionId(sessionId);

    return {
      protocolVersion: SUPPORTED_PROTOCOL_VERSION,
      capabilities: {
        tools: {
          listChanged: false,
        },
      },
      serverInfo: {
        name: "zeus-app-backend-mcp",
        version: "0.1.0",
      },
      instructions:
        "Use tools/list then tools/call. Every tool call must include owner_type, owner_key, project_key.",
    };
  }

  private requireSession(context: McpRequestContext): SessionState {
    const sessionId = String(context.sessionId ?? "").trim();
    if (!sessionId) {
      throw new McpJsonRpcError(-32001, "Missing MCP session id");
    }
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new McpJsonRpcError(-32001, "MCP session not initialized");
    }
    if (session.userId !== context.user.id) {
      throw new McpJsonRpcError(-32003, "Session user mismatch");
    }
    session.lastSeenAt = Date.now();
    return session;
  }

  private markSessionInitialized(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.initialized = true;
    session.lastSeenAt = Date.now();
  }

  private async handleToolCall(
    request: JsonRpcRequest,
    context: McpRequestContext,
    traceId: string,
  ): Promise<Record<string, unknown>> {
    const params = request.params;
    if (!isObjectRecord(params)) {
      throw new McpJsonRpcError(-32602, "Invalid params: expected object");
    }
    const toolName = String(params.name ?? "").trim();
    if (!toolName) {
      throw new McpJsonRpcError(-32602, "Invalid params: name is required");
    }
    const args = isObjectRecord(params.arguments)
      ? (params.arguments as Record<string, unknown>)
      : {};

    const tool = this.tools.get(toolName);
    if (!tool || !tool.enabled) {
      throw new McpJsonRpcError(-32602, `Unknown tool: ${toolName}`);
    }

    const toolSpan = traceManager.startSpan(
      traceManager.getTrace(traceId) || traceManager.startTrace(traceId, { name: "mcp.request" }),
      `mcp.tool.${toolName}`,
      args,
    );

    try {
      const result = await tool.execute(args, {
        user: context.user,
        requestId: String(request.id ?? randomUUID()),
        sessionId: String(context.sessionId),
      });
      traceManager.endSpan(toolSpan, { tool: toolName, ok: true });
      return {
        structuredContent: result.structuredContent,
        content: [
          {
            type: "text",
            text:
              result.text ||
              `Tool ${toolName} completed.`,
          },
        ],
        isError: result.isError === true,
      };
    } catch (err) {
      const mapped =
        err instanceof McpToolExecutionError
          ? err
          : new McpToolExecutionError(
              "INTERNAL_ERROR",
              err instanceof Error ? err.message : "Tool execution failed",
              500,
            );
      traceManager.endSpan(
        toolSpan,
        {
          tool: toolName,
          ok: false,
          code: mapped.code,
          message: mapped.message,
        },
        "ERROR",
      );
      return {
        structuredContent: {
          code: mapped.code,
          message: mapped.message,
          status: mapped.status,
          details: sanitizeErrorData(mapped.details),
        },
        content: [
          {
            type: "text",
            text: `${mapped.code}: ${mapped.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  private toErrorResponse(id: JsonRpcId, err: unknown): JsonRpcErrorResponse {
    if (err instanceof McpJsonRpcError) {
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: err.code,
          message: err.message,
          data: sanitizeErrorData(err.data),
        },
      };
    }
    if (err instanceof McpToolExecutionError) {
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32000,
          message: err.message,
          data: {
            code: err.code,
            status: err.status,
            details: sanitizeErrorData(err.details),
          },
        },
      };
    }
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32603,
        message: err instanceof Error ? err.message : "Internal error",
      },
    };
  }
}
