export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params?: Record<string, unknown>;
};

export type JsonRpcSuccessResponse = {
  jsonrpc: "2.0";
  id: string;
  result: unknown;
};

export type JsonRpcErrorResponse = {
  jsonrpc: "2.0";
  id: string;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
};

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

export function isRequest(payload: unknown): payload is JsonRpcRequest {
  if (!payload || typeof payload !== "object") return false;
  const value = payload as Record<string, unknown>;
  return value.jsonrpc === "2.0" && typeof value.id === "string" && typeof value.method === "string";
}

export function isResponse(payload: unknown): payload is JsonRpcResponse {
  if (!payload || typeof payload !== "object") return false;
  const value = payload as Record<string, unknown>;
  return value.jsonrpc === "2.0" && typeof value.id === "string" && ("result" in value || "error" in value);
}

export function makeSuccess(id: string, result: unknown): JsonRpcSuccessResponse {
  return { jsonrpc: "2.0", id, result };
}

export function makeError(id: string, code: number, message: string, data?: unknown): JsonRpcErrorResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data }),
    },
  };
}
