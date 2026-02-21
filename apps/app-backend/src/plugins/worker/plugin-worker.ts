import readline from "node:readline";
import { pathToFileURL } from "node:url";

import type { ZeusBackendPlugin, BackendPluginContext } from "@zeus/plugin-sdk-backend";

import {
  isRequest,
  isResponse,
  makeError,
  makeSuccess,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "./protocol.js";

type PendingHostCall = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type ExecuteContextPayload = {
  pluginId: string;
  projectKey: string;
  userId: string;
  capabilities?: string[];
  permissions?: {
    allowedHttpHosts?: string[];
    maxExecutionMs?: number;
  };
};

let pluginInstance: ZeusBackendPlugin | null = null;
let pendingHostCalls = new Map<string, PendingHostCall>();
let hostSeq = 0;

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

function writeMessage(payload: JsonRpcResponse | JsonRpcRequest): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

async function loadPlugin(pluginPath: string): Promise<void> {
  const moduleUrl = pathToFileURL(pluginPath).href;
  const loaded = await import(`${moduleUrl}?v=${Date.now()}`);
  const plugin = (loaded.default || loaded.plugin) as ZeusBackendPlugin | undefined;
  const hasOperationExecutor = typeof plugin?.execute === "function";
  const hasCommandExecutor = typeof plugin?.executeCommand === "function";
  const hasHookExecutor = typeof plugin?.runHook === "function";
  if (!plugin || (!hasOperationExecutor && !hasCommandExecutor && !hasHookExecutor)) {
    throw new Error(`Invalid backend plugin module: ${pluginPath}`);
  }
  pluginInstance = plugin;
}

function hostCall(method: string, args: Record<string, unknown>): Promise<unknown> {
  const id = `host-${++hostSeq}`;
  const request: JsonRpcRequest = {
    jsonrpc: "2.0",
    id,
    method: "host.call",
    params: {
      method,
      args,
    },
  };

  writeMessage(request);

  return new Promise((resolve, reject) => {
    pendingHostCalls.set(id, {
      resolve,
      reject,
    });
  });
}

function buildContext(payload: ExecuteContextPayload): BackendPluginContext {
  return {
    pluginId: payload.pluginId,
    projectKey: payload.projectKey,
    userId: payload.userId,
    capabilities: payload.capabilities || [],
    permissions: {
      allowedHttpHosts: payload.permissions?.allowedHttpHosts || [],
      maxExecutionMs: Number(payload.permissions?.maxExecutionMs || 20000),
    },
    host: {
      getPluginSettings: async (pluginId) => {
        const result = await hostCall("getPluginSettings", { pluginId });
        return (result as Record<string, unknown>) || {};
      },
      listPluginDataFiles: async (options) => {
        const result = await hostCall("listPluginDataFiles", {
          pluginId: options?.pluginId,
          projectKey: options?.projectKey,
          scope: options?.scope,
          dir: options?.dir,
          limit: options?.limit,
        });
        if (!Array.isArray(result)) {
          return [];
        }
        const normalized: Array<{
          path: string;
          name: string;
          type: "file" | "directory";
          size?: number;
          updatedAt?: string;
        }> = [];
        for (const item of result) {
          if (!item || typeof item !== "object") {
            continue;
          }
          const row = item as {
            path?: unknown;
            name?: unknown;
            type?: unknown;
            size?: unknown;
            updatedAt?: unknown;
          };
          const path = String(row.path || "").trim();
          const name = String(row.name || "").trim();
          const type = String(row.type || "").trim() === "directory" ? "directory" : "file";
          if (!path || !name) {
            continue;
          }
          normalized.push({
            path,
            name,
            type,
            size: typeof row.size === "number" ? row.size : undefined,
            updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : undefined,
          });
        }
        return normalized;
      },
      readPluginDataFile: async (path, options) => {
        const result = await hostCall("readPluginDataFile", {
          pluginId: options?.pluginId,
          projectKey: options?.projectKey,
          scope: options?.scope,
          path,
          encoding: options?.encoding,
        });
        const row = (result as {
          path?: string;
          content?: string;
          encoding?: "utf8" | "base64";
          size?: number;
          updatedAt?: string;
        }) || {};
        return {
          path: String(row.path || path),
          content: typeof row.content === "string" ? row.content : "",
          encoding: row.encoding === "base64" ? "base64" : "utf8",
          size: typeof row.size === "number" ? row.size : 0,
          updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : "",
        };
      },
      writePluginDataFile: async (path, content, options) => {
        const result = await hostCall("writePluginDataFile", {
          pluginId: options?.pluginId,
          projectKey: options?.projectKey,
          scope: options?.scope,
          path,
          content,
          encoding: options?.encoding,
          overwrite: options?.overwrite,
        });
        const row = (result as {
          path?: string;
          size?: number;
          updatedAt?: string;
        }) || {};
        return {
          path: String(row.path || path),
          size: Number(row.size || 0),
          updatedAt: String(row.updatedAt || ""),
        };
      },
      deletePluginDataFile: async (path, options) => {
        const result = await hostCall("deletePluginDataFile", {
          pluginId: options?.pluginId,
          projectKey: options?.projectKey,
          scope: options?.scope,
          path,
        });
        const row = (result as { deleted?: boolean }) || {};
        return {
          deleted: row.deleted === true,
        };
      },
      getDocument: async (projectKey, docId) => {
        const result = await hostCall("getDocument", { projectKey, docId });
        return (result as Record<string, unknown> | null) || null;
      },
      listDocuments: async (projectKey, parentId) => {
        const result = await hostCall("listDocuments", { projectKey, parentId });
        return Array.isArray(result) ? result as Record<string, unknown>[] : [];
      },
      createDocument: async (projectKey, doc) => {
        const result = await hostCall("createDocument", { projectKey, doc });
        return (result as Record<string, unknown>) || {};
      },
      updateDocument: async (projectKey, doc) => {
        const result = await hostCall("updateDocument", { projectKey, doc });
        return (result as Record<string, unknown>) || {};
      },
      moveDocument: async (projectKey, docId, targetParentId, beforeDocId, afterDocId) => {
        const result = await hostCall("moveDocument", {
          projectKey,
          docId,
          targetParentId,
          beforeDocId,
          afterDocId,
        });
        return (result as Record<string, unknown>) || {};
      },
      deleteDocument: async (projectKey, docId, recursive) => {
        const result = await hostCall("deleteDocument", { projectKey, docId, recursive });
        return (result as Record<string, unknown>) || {};
      },
      saveDocument: async (projectKey, doc) => {
        const result = await hostCall("saveDocument", { projectKey, doc });
        return (result as Record<string, unknown>) || {};
      },
      getAssetMeta: async (projectKey, assetId) => {
        const result = await hostCall("getAssetMeta", { projectKey, assetId });
        return (result as Record<string, unknown> | null) || null;
      },
      searchKnowledge: async (projectKey, query, limit) => {
        const result = await hostCall("searchKnowledge", { projectKey, query, limit });
        return (result as Record<string, unknown>) || {};
      },
      getKnowledgeSources: async (projectKey, query, limit) => {
        const result = await hostCall("getKnowledgeSources", { projectKey, query, limit });
        return (result as Record<string, unknown>) || {};
      },
      exportDocumentPpt: async (projectKey, docId, request) => {
        const result = await hostCall("exportDocumentPpt", { projectKey, docId, request });
        const row = (result as {
          taskId?: string;
          status?: string;
        }) || {};
        return {
          taskId: String(row.taskId || ""),
          status: String(row.status || ""),
        };
      },
      generatePptFromHtml: async (projectKey, html, options) => {
        const result = await hostCall("generatePptFromHtml", {
          projectKey,
          html,
          fileName: options?.fileName,
          style: options?.style,
          options: options?.options,
          waitMs: options?.waitMs,
          pollIntervalMs: options?.pollIntervalMs,
        });
        const row = (result as {
          taskId?: string;
          status?: string;
          asset?: {
            id?: string;
            filename?: string;
            mime?: string;
            size?: number;
          } | null;
          error?: string;
          waitedMs?: number;
        }) || {};
        return {
          taskId: String(row.taskId || ""),
          status: String(row.status || ""),
          asset: row.asset
            ? {
                id: String(row.asset.id || ""),
                filename: String(row.asset.filename || ""),
                mime: String(row.asset.mime || ""),
                size: typeof row.asset.size === "number" ? row.asset.size : 0,
              }
            : null,
          error: typeof row.error === "string" ? row.error : undefined,
          waitedMs: typeof row.waitedMs === "number" ? row.waitedMs : undefined,
        };
      },
      getPptTaskStatus: async (taskId) => {
        const result = await hostCall("getPptTaskStatus", { taskId });
        const row = (result as {
          taskId?: string;
          status?: string;
          progress?: number;
          currentSlide?: number;
          totalSlides?: number;
          error?: string;
          createdAt?: string;
          updatedAt?: string;
        }) || {};
        return {
          taskId: String(row.taskId || ""),
          status: String(row.status || ""),
          progress: typeof row.progress === "number" ? row.progress : undefined,
          currentSlide: typeof row.currentSlide === "number" ? row.currentSlide : undefined,
          totalSlides: typeof row.totalSlides === "number" ? row.totalSlides : undefined,
          error: typeof row.error === "string" ? row.error : undefined,
          createdAt: typeof row.createdAt === "string" ? row.createdAt : undefined,
          updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : undefined,
        };
      },
      fetchUrl: async (url, init) => {
        const result = await hostCall("fetchUrl", {
          url,
          init: init ? JSON.parse(JSON.stringify(init)) as Record<string, unknown> : undefined,
        });
        return (result as Record<string, unknown>) || {};
      },
      trace: {
        isEnabled: async () => {
          const result = await hostCall("trace.isEnabled", {});
          return result === true;
        },
        startSpan: async (name, input) => {
          const result = await hostCall("trace.startSpan", { name, input });
          const row = (result as { spanId?: string } | null) || null;
          if (!row || typeof row.spanId !== "string" || !row.spanId.trim()) {
            return null;
          }
          return { spanId: row.spanId };
        },
        endSpan: async (spanId, output, level) => {
          const result = await hostCall("trace.endSpan", { spanId, output, level });
          const row = (result as { ok?: boolean } | null) || null;
          return { ok: row?.ok === true };
        },
        logGeneration: async (params) => {
          const result = await hostCall("trace.logGeneration", { params });
          const row = (result as { ok?: boolean } | null) || null;
          return { ok: row?.ok === true };
        },
        startGeneration: async (params) => {
          const result = await hostCall("trace.startGeneration", { params });
          const row = (result as { generationId?: string } | null) || null;
          if (!row || typeof row.generationId !== "string" || !row.generationId.trim()) {
            return null;
          }
          return { generationId: row.generationId };
        },
        endGeneration: async (generationId, output, usage, level, statusMessage) => {
          const result = await hostCall("trace.endGeneration", {
            generationId,
            output,
            usage,
            level,
            statusMessage,
          });
          const row = (result as { ok?: boolean } | null) || null;
          return { ok: row?.ok === true };
        },
      },
    },
  };
}

async function handleRequest(request: JsonRpcRequest): Promise<void> {
  try {
    if (request.method === "init") {
      const pluginPath = String(request.params?.pluginPath || "").trim();
      if (!pluginPath) {
        writeMessage(makeError(request.id, -32602, "pluginPath is required"));
        return;
      }
      await loadPlugin(pluginPath);
      writeMessage(makeSuccess(request.id, { ok: true }));
      return;
    }

    if (!pluginInstance) {
      writeMessage(makeError(request.id, -32000, "Plugin worker is not initialized"));
      return;
    }

    if (request.method === "listOperations") {
      const operations = typeof pluginInstance.listOperations === "function"
        ? await pluginInstance.listOperations()
        : [];
      writeMessage(makeSuccess(request.id, operations));
      return;
    }

    if (request.method === "execute") {
      const operationId = String(request.params?.operationId || "").trim();
      if (!operationId) {
        writeMessage(makeError(request.id, -32602, "operationId is required"));
        return;
      }

      const input = request.params?.input && typeof request.params.input === "object"
        ? (request.params.input as Record<string, unknown>)
        : {};

      const ctxPayload = request.params?.context && typeof request.params.context === "object"
        ? (request.params.context as ExecuteContextPayload)
        : null;
      if (!ctxPayload) {
        writeMessage(makeError(request.id, -32602, "context is required"));
        return;
      }

      const ctx = buildContext(ctxPayload);
      let result: Record<string, unknown> | undefined;
      if (typeof pluginInstance.execute === "function") {
        result = await pluginInstance.execute(operationId, input, ctx);
      } else if (typeof pluginInstance.executeCommand === "function") {
        result = await pluginInstance.executeCommand(operationId, input, ctx);
      } else if (typeof pluginInstance.runHook === "function") {
        result = await pluginInstance.runHook(operationId, input, ctx) as Record<string, unknown>;
      } else {
        throw new Error("Plugin does not implement execute/executeCommand/runHook");
      }
      writeMessage(makeSuccess(request.id, result || {}));
      return;
    }

    if (request.method === "executeCommand") {
      const commandId = String(request.params?.commandId || "").trim();
      if (!commandId) {
        writeMessage(makeError(request.id, -32602, "commandId is required"));
        return;
      }
      const input = request.params?.input && typeof request.params.input === "object"
        ? (request.params.input as Record<string, unknown>)
        : {};
      const ctxPayload = request.params?.context && typeof request.params.context === "object"
        ? (request.params.context as ExecuteContextPayload)
        : null;
      if (!ctxPayload) {
        writeMessage(makeError(request.id, -32602, "context is required"));
        return;
      }
      const ctx = buildContext(ctxPayload);
      let result: Record<string, unknown> | undefined;
      if (typeof pluginInstance.executeCommand === "function") {
        result = await pluginInstance.executeCommand(commandId, input, ctx);
      } else if (typeof pluginInstance.execute === "function") {
        result = await pluginInstance.execute(commandId, input, ctx);
      } else {
        throw new Error("Plugin does not implement executeCommand/execute");
      }
      writeMessage(makeSuccess(request.id, result || {}));
      return;
    }

    if (request.method === "runHook") {
      const hookId = String(request.params?.hookId || "").trim();
      if (!hookId) {
        writeMessage(makeError(request.id, -32602, "hookId is required"));
        return;
      }
      const input = request.params?.input && typeof request.params.input === "object"
        ? (request.params.input as Record<string, unknown>)
        : {};
      const ctxPayload = request.params?.context && typeof request.params.context === "object"
        ? (request.params.context as ExecuteContextPayload)
        : null;
      if (!ctxPayload) {
        writeMessage(makeError(request.id, -32602, "context is required"));
        return;
      }
      const ctx = buildContext(ctxPayload);
      let result: unknown;
      if (typeof pluginInstance.runHook === "function") {
        result = await pluginInstance.runHook(hookId, input, ctx);
      } else if (typeof pluginInstance.execute === "function") {
        result = await pluginInstance.execute(hookId, input, ctx);
      } else {
        throw new Error("Plugin does not implement runHook/execute");
      }
      writeMessage(makeSuccess(request.id, result || {}));
      return;
    }

    writeMessage(makeError(request.id, -32601, `Unknown method: ${request.method}`));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    writeMessage(makeError(request.id, -32000, message));
  }
}

function handleResponse(response: JsonRpcResponse): void {
  const pending = pendingHostCalls.get(response.id);
  if (!pending) {
    return;
  }
  pendingHostCalls.delete(response.id);
  if ("error" in response) {
    pending.reject(new Error(response.error.message));
    return;
  }
  pending.resolve(response.result);
}

rl.on("line", (line) => {
  const raw = line.trim();
  if (!raw) {
    return;
  }
  try {
    const payload = JSON.parse(raw) as unknown;
    if (isResponse(payload)) {
      handleResponse(payload);
      return;
    }
    if (isRequest(payload)) {
      void handleRequest(payload);
      return;
    }
  } catch (err) {
    process.stderr.write(`plugin worker invalid payload: ${err}\n`);
  }
});

rl.on("close", () => {
  for (const [, pending] of pendingHostCalls) {
    pending.reject(new Error("plugin worker closed"));
  }
  pendingHostCalls.clear();
  process.exit(0);
});
