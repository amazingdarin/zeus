import type {
  BeforeHookResultV2,
  PluginDocHookEventV2,
  PluginDocHookStageV2,
} from "@zeus/plugin-sdk-shared";

import type {
  HookBeforeResultV2,
  HookDispatchInputV2,
  HookWorkerResultV2,
  PluginHookRuntimeItemV2,
} from "./types.js";

type JsonPatchOperation = {
  op: "add" | "remove" | "replace";
  path: string;
  value?: unknown;
};

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function parsePath(path: string): string[] {
  return String(path || "")
    .trim()
    .split("/")
    .filter((segment, idx) => !(idx === 0 && segment === ""))
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function setByPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const keys = parsePath(path);
  if (keys.length === 0) {
    throw new Error("JSON patch root replace is not supported");
  }

  let cursor: Record<string, unknown> = target;
  for (let idx = 0; idx < keys.length - 1; idx += 1) {
    const key = keys[idx];
    const next = cursor[key];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[keys[keys.length - 1]] = value;
}

function removeByPath(target: Record<string, unknown>, path: string): void {
  const keys = parsePath(path);
  if (keys.length === 0) {
    throw new Error("JSON patch root remove is not supported");
  }

  let cursor: Record<string, unknown> = target;
  for (let idx = 0; idx < keys.length - 1; idx += 1) {
    const key = keys[idx];
    const next = cursor[key];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      return;
    }
    cursor = next as Record<string, unknown>;
  }
  delete cursor[keys[keys.length - 1]];
}

function applyJsonPatch(
  source: Record<string, unknown>,
  patch: JsonPatchOperation[],
): Record<string, unknown> {
  const cloned = deepClone(source);
  for (const op of patch) {
    if (!op || typeof op !== "object") continue;
    if (op.op === "remove") {
      removeByPath(cloned, op.path);
      continue;
    }
    if (op.op === "add" || op.op === "replace") {
      setByPath(cloned, op.path, op.value);
    }
  }
  return cloned;
}

function normalizeBeforeResult(value: HookWorkerResultV2): BeforeHookResultV2 | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Record<string, unknown>;
  const decisionRaw = String(row.decision || "").trim();
  if (decisionRaw !== "allow" && decisionRaw !== "mutate" && decisionRaw !== "reject") {
    return null;
  }

  return {
    decision: decisionRaw,
    payload: row.payload && typeof row.payload === "object"
      ? row.payload as Record<string, unknown>
      : undefined,
    patch: Array.isArray(row.patch)
      ? row.patch.filter((item) => item && typeof item === "object") as JsonPatchOperation[]
      : undefined,
    errorCode: typeof row.errorCode === "string" ? row.errorCode : undefined,
    message: typeof row.message === "string" ? row.message : undefined,
  };
}

function sortHooks(hooks: PluginHookRuntimeItemV2[]): PluginHookRuntimeItemV2[] {
  return [...hooks].sort((a, b) => {
    const pa = Number.isFinite(Number(a.priority)) ? Number(a.priority) : 0;
    const pb = Number.isFinite(Number(b.priority)) ? Number(b.priority) : 0;
    if (pa !== pb) {
      return pb - pa;
    }
    return a.pluginId.localeCompare(b.pluginId);
  });
}

export class HookOrchestratorV2 {
  constructor(
    private readonly listHooks: (
      userId: string,
      event: PluginDocHookEventV2,
      stage: PluginDocHookStageV2,
    ) => Promise<PluginHookRuntimeItemV2[]>,
    private readonly executeHook: (
      hook: PluginHookRuntimeItemV2,
      input: {
        userId: string;
        projectKey: string;
        payload: Record<string, unknown>;
      },
    ) => Promise<HookWorkerResultV2>,
    private readonly appendAudit: (input: {
      userId: string;
      pluginId: string;
      operationId: string;
      projectScope: string;
      status: string;
      durationMs: number;
      error?: string;
      eventType?: string;
      hookStage?: "before" | "after";
      decision?: string;
      requestId?: string;
    }) => Promise<void>,
  ) {}

  async runBefore(input: HookDispatchInputV2): Promise<HookBeforeResultV2> {
    const hooks = sortHooks(await this.listHooks(input.userId, input.event, "before"));
    if (hooks.length === 0) {
      return {
        allowed: true,
        payload: input.payload,
      };
    }

    let currentPayload = deepClone(input.payload);

    for (const hook of hooks) {
      const startedAt = Date.now();
      try {
        const rawResult = await this.executeHook(hook, {
          userId: input.userId,
          projectKey: input.projectKey,
          payload: currentPayload,
        });
        const result = normalizeBeforeResult(rawResult);

        if (!result) {
          await this.appendAudit({
            userId: input.userId,
            pluginId: hook.pluginId,
            operationId: hook.id,
            projectScope: input.projectKey,
            status: "ok",
            durationMs: Date.now() - startedAt,
            eventType: "hook.before",
            hookStage: "before",
            decision: "allow",
            requestId: input.requestId,
          });
          continue;
        }

        if (result.decision === "mutate") {
          if (result.payload && typeof result.payload === "object") {
            currentPayload = deepClone(result.payload);
          } else if (Array.isArray(result.patch) && result.patch.length > 0) {
            currentPayload = applyJsonPatch(currentPayload, result.patch as JsonPatchOperation[]);
          }
          await this.appendAudit({
            userId: input.userId,
            pluginId: hook.pluginId,
            operationId: hook.id,
            projectScope: input.projectKey,
            status: "ok",
            durationMs: Date.now() - startedAt,
            eventType: "hook.before",
            hookStage: "before",
            decision: "mutate",
            requestId: input.requestId,
          });
          continue;
        }

        if (result.decision === "reject") {
          await this.appendAudit({
            userId: input.userId,
            pluginId: hook.pluginId,
            operationId: hook.id,
            projectScope: input.projectKey,
            status: "ok",
            durationMs: Date.now() - startedAt,
            eventType: "hook.before",
            hookStage: "before",
            decision: "reject",
            requestId: input.requestId,
          });
          return {
            allowed: false,
            payload: currentPayload,
            rejection: {
              code: result.errorCode || "PLUGIN_HOOK_REJECTED",
              message: result.message || `Plugin hook rejected: ${hook.id}`,
              status: 400,
            },
          };
        }

        await this.appendAudit({
          userId: input.userId,
          pluginId: hook.pluginId,
          operationId: hook.id,
          projectScope: input.projectKey,
          status: "ok",
          durationMs: Date.now() - startedAt,
          eventType: "hook.before",
          hookStage: "before",
          decision: "allow",
          requestId: input.requestId,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await this.appendAudit({
          userId: input.userId,
          pluginId: hook.pluginId,
          operationId: hook.id,
          projectScope: input.projectKey,
          status: "error",
          durationMs: Date.now() - startedAt,
          error: message,
          eventType: "hook.before",
          hookStage: "before",
          decision: "fail_open",
          requestId: input.requestId,
        });
      }
    }

    return {
      allowed: true,
      payload: currentPayload,
    };
  }

  dispatchAfter(input: HookDispatchInputV2): void {
    void this.runAfter(input);
  }

  async runAfter(input: HookDispatchInputV2): Promise<void> {
    const hooks = sortHooks(await this.listHooks(input.userId, input.event, "after"));
    if (hooks.length === 0) {
      return;
    }

    await Promise.allSettled(hooks.map(async (hook) => {
      const startedAt = Date.now();
      try {
        await this.executeHook(hook, {
          userId: input.userId,
          projectKey: input.projectKey,
          payload: input.payload,
        });
        await this.appendAudit({
          userId: input.userId,
          pluginId: hook.pluginId,
          operationId: hook.id,
          projectScope: input.projectKey,
          status: "ok",
          durationMs: Date.now() - startedAt,
          eventType: "hook.after",
          hookStage: "after",
          decision: "allow",
          requestId: input.requestId,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await this.appendAudit({
          userId: input.userId,
          pluginId: hook.pluginId,
          operationId: hook.id,
          projectScope: input.projectKey,
          status: "error",
          durationMs: Date.now() - startedAt,
          error: message,
          eventType: "hook.after",
          hookStage: "after",
          decision: "fail_open",
          requestId: input.requestId,
        });
      }
    }));
  }
}
