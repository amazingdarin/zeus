import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { pluginConfig } from "../config.js";
import {
  isRequest,
  isResponse,
  makeError,
  makeSuccess,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "./protocol.js";

type PendingCall = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export type WorkerExecutionContext = {
  pluginId: string;
  userId: string;
  projectKey: string;
  capabilities?: string[];
  permissions: {
    allowedHttpHosts: string[];
    maxExecutionMs: number;
  };
};

export type WorkerHostCallHandler = (
  context: WorkerExecutionContext,
  method: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

class WorkerClient {
  private child: ChildProcessWithoutNullStreams;
  private pending = new Map<string, PendingCall>();
  private sequence = 0;
  private queue: Promise<void> = Promise.resolve();
  private stdoutBuffer = "";
  private activeContext: WorkerExecutionContext | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private disposed = false;

  constructor(
    private readonly pluginKey: string,
    private readonly workerScriptPath: string,
    private readonly hostCallHandler: WorkerHostCallHandler,
    private readonly idleMs: number,
  ) {
    this.child = this.spawnProcess(workerScriptPath);
    this.setupProcessHandlers();
    this.touch();
  }

  private spawnProcess(scriptPath: string): ChildProcessWithoutNullStreams {
    const args = [...process.execArgv, scriptPath];
    const safeEnv: NodeJS.ProcessEnv = {
      NODE_ENV: process.env.NODE_ENV || "production",
    };
    if (process.env.TZ) safeEnv.TZ = process.env.TZ;
    if (process.env.LANG) safeEnv.LANG = process.env.LANG;

    return spawn(process.execPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: safeEnv,
    });
  }

  private setupProcessHandlers(): void {
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => {
      this.stdoutBuffer += chunk;
      let newlineIndex = this.stdoutBuffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
        this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
        if (line) {
          this.handleLine(line);
        }
        newlineIndex = this.stdoutBuffer.indexOf("\n");
      }
    });

    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) => {
      const message = chunk.trim();
      if (message) {
        console.warn(`[plugin-worker:${this.pluginKey}] ${message}`);
      }
    });

    this.child.on("exit", (code, signal) => {
      this.disposed = true;
      this.activeContext = null;
      if (this.idleTimer) {
        clearTimeout(this.idleTimer);
        this.idleTimer = null;
      }
      const reason = `Plugin worker exited (${this.pluginKey}) code=${code} signal=${signal}`;
      const error = new Error(reason);
      for (const [, pending] of this.pending) {
        pending.reject(error);
      }
      this.pending.clear();
    });
  }

  private handleLine(line: string): void {
    try {
      const payload = JSON.parse(line) as unknown;
      if (isResponse(payload)) {
        this.handleResponse(payload);
        return;
      }
      if (isRequest(payload)) {
        void this.handleRequest(payload);
      }
    } catch (err) {
      console.warn(`[plugin-worker:${this.pluginKey}] invalid payload: ${err}`);
    }
  }

  private handleResponse(response: JsonRpcResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) {
      return;
    }
    this.pending.delete(response.id);
    if ("error" in response) {
      pending.reject(new Error(response.error.message));
      return;
    }
    pending.resolve(response.result);
  }

  private async handleRequest(request: JsonRpcRequest): Promise<void> {
    if (request.method !== "host.call") {
      this.writeMessage(makeError(request.id, -32601, `Unknown worker request: ${request.method}`));
      return;
    }

    const method = String(request.params?.method || "").trim();
    const args = request.params?.args && typeof request.params.args === "object"
      ? request.params.args as Record<string, unknown>
      : {};

    if (!method) {
      this.writeMessage(makeError(request.id, -32602, "host.call method is required"));
      return;
    }

    if (!this.activeContext) {
      this.writeMessage(makeError(request.id, -32000, "No active execution context"));
      return;
    }

    try {
      const result = await this.hostCallHandler(this.activeContext, method, args);
      this.writeMessage(makeSuccess(request.id, result));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.writeMessage(makeError(request.id, -32000, message));
    }
  }

  private writeMessage(payload: JsonRpcRequest | JsonRpcResponse): void {
    if (this.disposed || !this.child.stdin.writable) {
      throw new Error(`Plugin worker is not writable (${this.pluginKey})`);
    }
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  private callRpc(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (this.disposed) {
      return Promise.reject(new Error(`Plugin worker is not running (${this.pluginKey})`));
    }
    const id = `${Date.now()}-${++this.sequence}`;
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.writeMessage(request);
    });
  }

  private callRpcWithTimeout(
    method: string,
    params: Record<string, unknown> | undefined,
    timeoutMs: number,
  ): Promise<unknown> {
    const effectiveTimeoutMs = Math.max(1, Math.round(timeoutMs || 0));
    if (!Number.isFinite(effectiveTimeoutMs) || effectiveTimeoutMs <= 0) {
      return this.callRpc(method, params);
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        this.dispose(`Plugin worker timeout (${this.pluginKey}, method=${method})`);
        reject(new Error(`Plugin worker timeout: ${method}`));
      }, effectiveTimeoutMs);

      this.callRpc(method, params)
        .then((result) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.then(() => undefined, () => undefined);
    return next;
  }

  private touch(): void {
    if (this.disposed || this.idleMs <= 0) {
      return;
    }
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    this.idleTimer = setTimeout(() => {
      this.dispose(`Plugin worker idle timeout (${this.pluginKey})`);
    }, this.idleMs);
  }

  async init(pluginPath: string): Promise<void> {
    await this.enqueue(async () => {
      this.touch();
      await this.callRpcWithTimeout("init", { pluginPath }, pluginConfig.maxExecutionMs);
    });
  }

  async listOperations(timeoutMs: number): Promise<unknown[]> {
    return this.enqueue(async () => {
      this.touch();
      const result = await this.callRpcWithTimeout("listOperations", undefined, timeoutMs);
      return Array.isArray(result) ? result : [];
    });
  }

  async execute(
    operationId: string,
    input: Record<string, unknown>,
    context: WorkerExecutionContext,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> {
    return this.enqueue(async () => {
      this.touch();
      this.activeContext = context;
      try {
        const result = await this.callRpcWithTimeout("execute", {
          operationId,
          input,
          context,
        }, timeoutMs);
        if (!result || typeof result !== "object") {
          return {};
        }
        return result as Record<string, unknown>;
      } finally {
        this.activeContext = null;
      }
    });
  }

  async executeCommand(
    commandId: string,
    input: Record<string, unknown>,
    context: WorkerExecutionContext,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> {
    return this.enqueue(async () => {
      this.touch();
      this.activeContext = context;
      try {
        const result = await this.callRpcWithTimeout("executeCommand", {
          commandId,
          input,
          context,
        }, timeoutMs);
        if (!result || typeof result !== "object") {
          return {};
        }
        return result as Record<string, unknown>;
      } finally {
        this.activeContext = null;
      }
    });
  }

  async runHook(
    hookId: string,
    input: Record<string, unknown>,
    context: WorkerExecutionContext,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> {
    return this.enqueue(async () => {
      this.touch();
      this.activeContext = context;
      try {
        const result = await this.callRpcWithTimeout("runHook", {
          hookId,
          input,
          context,
        }, timeoutMs);
        if (!result || typeof result !== "object") {
          return {};
        }
        return result as Record<string, unknown>;
      } finally {
        this.activeContext = null;
      }
    });
  }

  isAlive(): boolean {
    if (this.disposed) {
      return false;
    }
    return this.child.exitCode === null && !this.child.killed;
  }

  dispose(reason = `Plugin worker disposed (${this.pluginKey})`): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.activeContext = null;
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    const error = new Error(reason);
    for (const [, pending] of this.pending) {
      pending.reject(error);
    }
    this.pending.clear();
    if (!this.child.killed) {
      this.child.kill("SIGTERM");
    }
  }
}

function resolveWorkerScriptPath(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const dir = path.dirname(currentFile);
  const jsPath = path.join(dir, "plugin-worker.js");
  if (existsSync(jsPath)) {
    return jsPath;
  }
  const tsPath = path.join(dir, "plugin-worker.ts");
  if (existsSync(tsPath)) {
    return tsPath;
  }
  throw new Error("Unable to resolve plugin worker entry file");
}

export class PluginWorkerPool {
  private readonly workers = new Map<string, WorkerClient>();
  private readonly workerScriptPath = resolveWorkerScriptPath();

  constructor(private readonly hostCallHandler: WorkerHostCallHandler) {}

  private getKey(pluginId: string, version: string): string {
    return `${pluginId}@${version}`;
  }

  private async getOrCreate(pluginId: string, version: string, pluginPath: string): Promise<WorkerClient> {
    const key = this.getKey(pluginId, version);
    let worker = this.workers.get(key);
    if (worker && !worker.isAlive()) {
      worker.dispose();
      this.workers.delete(key);
      worker = undefined;
    }
    if (!worker) {
      worker = new WorkerClient(key, this.workerScriptPath, this.hostCallHandler, pluginConfig.workerIdleMs);
      this.workers.set(key, worker);
      await worker.init(pluginPath);
    }
    return worker;
  }

  async listOperations(pluginId: string, version: string, pluginPath: string): Promise<unknown[]> {
    const worker = await this.getOrCreate(pluginId, version, pluginPath);
    try {
      return await worker.listOperations(pluginConfig.maxExecutionMs);
    } finally {
      if (!worker.isAlive()) {
        this.workers.delete(this.getKey(pluginId, version));
      }
    }
  }

  async execute(
    pluginId: string,
    version: string,
    pluginPath: string,
    operationId: string,
    input: Record<string, unknown>,
    context: WorkerExecutionContext,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> {
    const worker = await this.getOrCreate(pluginId, version, pluginPath);
    try {
      return await worker.execute(operationId, input, context, timeoutMs);
    } finally {
      if (!worker.isAlive()) {
        this.workers.delete(this.getKey(pluginId, version));
      }
    }
  }

  async executeCommand(
    pluginId: string,
    version: string,
    pluginPath: string,
    commandId: string,
    input: Record<string, unknown>,
    context: WorkerExecutionContext,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> {
    const worker = await this.getOrCreate(pluginId, version, pluginPath);
    try {
      return await worker.executeCommand(commandId, input, context, timeoutMs);
    } finally {
      if (!worker.isAlive()) {
        this.workers.delete(this.getKey(pluginId, version));
      }
    }
  }

  async runHook(
    pluginId: string,
    version: string,
    pluginPath: string,
    hookId: string,
    input: Record<string, unknown>,
    context: WorkerExecutionContext,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> {
    const worker = await this.getOrCreate(pluginId, version, pluginPath);
    try {
      return await worker.runHook(hookId, input, context, timeoutMs);
    } finally {
      if (!worker.isAlive()) {
        this.workers.delete(this.getKey(pluginId, version));
      }
    }
  }

  dispose(): void {
    for (const [, worker] of this.workers) {
      worker.dispose();
    }
    this.workers.clear();
  }
}
