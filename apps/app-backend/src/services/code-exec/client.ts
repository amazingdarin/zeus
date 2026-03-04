import type {
  CodeExecRun,
  ExecuteCodeRequest,
  GetCodeRunRequest,
  ListCodeRunsRequest,
  ListCodeRunsResponse,
} from "./types.js";

type JsonObject = Record<string, unknown>;

type JsonApiPayload = {
  code?: unknown;
  message?: unknown;
  data?: unknown;
};

export class CodeExecClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly data?: unknown;

  constructor(message: string, status: number, code = "CODE_EXEC_CLIENT_ERROR", data?: unknown) {
    super(message);
    this.name = "CodeExecClientError";
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

export type CodeExecClientDeps = {
  baseUrl: string;
  internalToken: string;
  fetchImpl: typeof fetch;
};

export type CodeExecClient = {
  execute(input: ExecuteCodeRequest): Promise<CodeExecRun>;
  listRuns(input: ListCodeRunsRequest): Promise<ListCodeRunsResponse>;
  getRun(input: GetCodeRunRequest): Promise<CodeExecRun>;
};

function toError(
  response: Response,
  payload: JsonApiPayload | null,
  fallbackCode: string,
  fallbackMessage: string,
): CodeExecClientError {
  const code = String(payload?.code ?? fallbackCode);
  const message = String(payload?.message ?? fallbackMessage);
  return new CodeExecClientError(message, response.status, code, payload?.data);
}

function normalizeRun(raw: unknown): CodeExecRun {
  const node = (raw && typeof raw === "object" ? raw : {}) as JsonObject;
  const result = (node.result && typeof node.result === "object" ? node.result : {}) as JsonObject;
  return {
    runId: String(node.runId ?? ""),
    status: String(node.status ?? "failed") as CodeExecRun["status"],
    result: {
      stdout: String(result.stdout ?? ""),
      stderr: String(result.stderr ?? ""),
      exitCode: Number(result.exitCode ?? 1),
      durationMs: Number(result.durationMs ?? 0),
      truncated: Boolean(result.truncated),
      timedOut: Boolean(result.timedOut),
    },
  };
}

function normalizeList(raw: unknown): ListCodeRunsResponse {
  const node = (raw && typeof raw === "object" ? raw : {}) as JsonObject;
  const items = Array.isArray(node.items) ? node.items.map((item) => normalizeRun(item)) : [];
  const nextCursor = String(node.nextCursor ?? "");
  return {
    items,
    nextCursor: nextCursor || undefined,
  };
}

function parsePayload(raw: unknown): JsonApiPayload | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  return raw as JsonApiPayload;
}

function withDefaultDeps(deps?: Partial<CodeExecClientDeps>): CodeExecClientDeps {
  const baseUrl = String(deps?.baseUrl ?? process.env.CODE_RUNNER_BASE_URL ?? "http://127.0.0.1:8091")
    .trim()
    .replace(/\/+$/, "");
  const internalToken = String(deps?.internalToken ?? process.env.CODE_RUNNER_INTERNAL_TOKEN ?? "").trim();
  const fetchImpl = deps?.fetchImpl ?? fetch;
  return {
    baseUrl,
    internalToken,
    fetchImpl,
  };
}

export function createCodeExecClient(deps?: Partial<CodeExecClientDeps>): CodeExecClient {
  const resolved = withDefaultDeps(deps);

  const request = async <T>(path: string, init: RequestInit, normalize: (raw: unknown) => T): Promise<T> => {
    const token = resolved.internalToken;
    if (!token) {
      throw new CodeExecClientError("code-runner token missing", 500, "CODE_RUNNER_TOKEN_MISSING");
    }

    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-code-runner-token": token,
    };
    if (init.headers && typeof init.headers === "object") {
      Object.assign(headers, init.headers as Record<string, string>);
    }

    const response = await resolved.fetchImpl(`${resolved.baseUrl}${path}`, {
      ...init,
      headers,
    });
    const payload = parsePayload(await response.json().catch(() => null));
    if (!response.ok) {
      throw toError(response, payload, "CODE_EXEC_REQUEST_FAILED", "code runner request failed");
    }

    if (!payload?.data) {
      throw new CodeExecClientError("code runner response missing data", response.status, "CODE_EXEC_INVALID_RESPONSE");
    }
    return normalize(payload.data);
  };

  return {
    execute(input: ExecuteCodeRequest): Promise<CodeExecRun> {
      return request(
        "/internal/code-exec/execute",
        {
          method: "POST",
          body: JSON.stringify(input),
        },
        normalizeRun,
      );
    },

    listRuns(input: ListCodeRunsRequest): Promise<ListCodeRunsResponse> {
      const params = new URLSearchParams();
      params.set("ownerType", input.ownerType);
      params.set("ownerId", input.ownerId);
      params.set("projectKey", input.projectKey);
      params.set("docId", input.docId);
      if (input.blockId) {
        params.set("blockId", input.blockId);
      }
      if (input.cursor) {
        params.set("cursor", input.cursor);
      }
      if (typeof input.limit === "number" && Number.isFinite(input.limit)) {
        params.set("limit", String(Math.max(1, Math.floor(input.limit))));
      }
      return request(`/internal/code-exec/runs?${params.toString()}`, { method: "GET" }, normalizeList);
    },

    getRun(input: GetCodeRunRequest): Promise<CodeExecRun> {
      const params = new URLSearchParams();
      params.set("ownerType", input.ownerType);
      params.set("ownerId", input.ownerId);
      params.set("projectKey", input.projectKey);
      params.set("docId", input.docId);
      return request(
        `/internal/code-exec/runs/${encodeURIComponent(input.runId)}?${params.toString()}`,
        { method: "GET" },
        normalizeRun,
      );
    },
  };
}

