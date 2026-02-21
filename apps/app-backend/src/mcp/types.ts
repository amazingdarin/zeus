import type { AuthUser } from "../middleware/auth.js";

export type JsonRpcId = string | number | null;

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: unknown;
};

export type JsonRpcSuccessResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: unknown;
};

export type JsonRpcErrorBody = {
  code: number;
  message: string;
  data?: unknown;
};

export type JsonRpcErrorResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: JsonRpcErrorBody;
};

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

export type McpToolResult = {
  structuredContent: Record<string, unknown>;
  text?: string;
  isError?: boolean;
};

export type McpToolContext = {
  user: AuthUser;
  sessionId: string;
  requestId: string;
};

export type McpToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
  enabled: boolean;
  execute: (
    args: Record<string, unknown>,
    context: McpToolContext,
  ) => Promise<McpToolResult>;
};

export type McpServerConfig = {
  enabled: boolean;
  path: string;
  requireAuth: boolean;
  allowedOrigins: string[];
  readToolsEnabled: boolean;
  writeToolsEnabled: boolean;
  maxLimit: number;
  maxTreeNodes: number;
};

export class McpJsonRpcError extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "McpJsonRpcError";
    this.code = code;
    this.data = data;
  }
}

export class McpToolExecutionError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = "McpToolExecutionError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export type McpRequestContext = {
  user: AuthUser;
  sessionId?: string;
  setSessionId: (sessionId: string) => void;
};
