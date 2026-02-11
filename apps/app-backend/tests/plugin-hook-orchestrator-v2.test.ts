import assert from "node:assert/strict";
import { test } from "node:test";

import { HookOrchestratorV2 } from "../src/plugins-v2/hook-orchestrator.ts";
import type { PluginHookRuntimeItemV2 } from "../src/plugins-v2/types.ts";

function createHook(
  input: Partial<PluginHookRuntimeItemV2> & { id: string },
): PluginHookRuntimeItemV2 {
  return {
    id: input.id,
    stage: input.stage || "before",
    event: input.event || "document.update",
    priority: input.priority,
    requiresDocScope: input.requiresDocScope,
    handler: input.handler || input.id,
    pluginId: input.pluginId || "plugin-a",
    version: input.version || "1.0.0",
    permissions: input.permissions || {
      allowedHttpHosts: [],
      maxExecutionMs: 15000,
      maxHookExecutionMs: 3000,
    },
  };
}

test("HookOrchestratorV2 runBefore applies mutate results by priority", async () => {
  const hooks = [
    createHook({ id: "low", priority: 5, pluginId: "plugin-z" }),
    createHook({ id: "high", priority: 10, pluginId: "plugin-a" }),
  ];
  const audits: Array<{ operationId: string; decision?: string; status: string }> = [];

  const orchestrator = new HookOrchestratorV2(
    async () => hooks,
    async (hook) => {
      if (hook.id === "high") {
        return {
          decision: "mutate",
          patch: [{ op: "replace", path: "/payload/title", value: "patched-title" }],
        };
      }
      return { decision: "allow" };
    },
    async (audit) => {
      audits.push({
        operationId: audit.operationId,
        decision: audit.decision,
        status: audit.status,
      });
    },
  );

  const result = await orchestrator.runBefore({
    userId: "u1",
    projectKey: "project-alpha",
    event: "document.update",
    payload: {
      payload: { title: "original-title" },
      untouched: true,
    },
    requestId: "req-1",
  });

  assert.equal(result.allowed, true);
  assert.equal((result.payload.payload as { title: string }).title, "patched-title");
  assert.equal(result.payload.untouched, true);
  assert.deepEqual(
    audits.map((audit) => [audit.operationId, audit.decision, audit.status]),
    [
      ["high", "mutate", "ok"],
      ["low", "allow", "ok"],
    ],
  );
});

test("HookOrchestratorV2 runBefore stops on reject", async () => {
  const hooks = [
    createHook({ id: "rejector", priority: 10, pluginId: "plugin-a" }),
    createHook({ id: "later-hook", priority: 1, pluginId: "plugin-b" }),
  ];
  const executed: string[] = [];
  const audits: Array<{ operationId: string; decision?: string; status: string }> = [];

  const orchestrator = new HookOrchestratorV2(
    async () => hooks,
    async (hook) => {
      executed.push(hook.id);
      if (hook.id === "rejector") {
        return {
          decision: "reject",
          errorCode: "DOC_WRITE_BLOCKED",
          message: "Rejected by policy",
        };
      }
      return { decision: "allow" };
    },
    async (audit) => {
      audits.push({
        operationId: audit.operationId,
        decision: audit.decision,
        status: audit.status,
      });
    },
  );

  const result = await orchestrator.runBefore({
    userId: "u1",
    projectKey: "project-alpha",
    event: "document.update",
    payload: { title: "original" },
    requestId: "req-2",
  });

  assert.equal(result.allowed, false);
  assert.equal(result.rejection?.code, "DOC_WRITE_BLOCKED");
  assert.equal(result.rejection?.message, "Rejected by policy");
  assert.deepEqual(executed, ["rejector"]);
  assert.deepEqual(
    audits.map((audit) => [audit.operationId, audit.decision, audit.status]),
    [["rejector", "reject", "ok"]],
  );
});

test("HookOrchestratorV2 runBefore fail-open continues after hook error", async () => {
  const hooks = [
    createHook({ id: "broken", priority: 10, pluginId: "plugin-a" }),
    createHook({ id: "mutator", priority: 5, pluginId: "plugin-b" }),
  ];
  const audits: Array<{ operationId: string; decision?: string; status: string }> = [];

  const orchestrator = new HookOrchestratorV2(
    async () => hooks,
    async (hook) => {
      if (hook.id === "broken") {
        throw new Error("hook timeout");
      }
      return {
        decision: "mutate",
        payload: { title: "mutated", source: "second-hook" },
      };
    },
    async (audit) => {
      audits.push({
        operationId: audit.operationId,
        decision: audit.decision,
        status: audit.status,
      });
    },
  );

  const result = await orchestrator.runBefore({
    userId: "u1",
    projectKey: "project-alpha",
    event: "document.update",
    payload: { title: "original" },
    requestId: "req-3",
  });

  assert.equal(result.allowed, true);
  assert.deepEqual(result.payload, { title: "mutated", source: "second-hook" });
  assert.deepEqual(
    audits.map((audit) => [audit.operationId, audit.decision, audit.status]),
    [
      ["broken", "fail_open", "error"],
      ["mutator", "mutate", "ok"],
    ],
  );
});

test("HookOrchestratorV2 dispatchAfter does not block caller and records async errors", async () => {
  const afterHook = createHook({
    id: "after-broken",
    stage: "after",
    event: "document.update",
    pluginId: "plugin-a",
  });
  const audits: Array<{ operationId: string; decision?: string; status: string }> = [];

  const orchestrator = new HookOrchestratorV2(
    async (_userId, _event, stage) => (stage === "after" ? [afterHook] : []),
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      throw new Error("after hook failed");
    },
    async (audit) => {
      audits.push({
        operationId: audit.operationId,
        decision: audit.decision,
        status: audit.status,
      });
    },
  );

  const startedAt = Date.now();
  orchestrator.dispatchAfter({
    userId: "u1",
    projectKey: "project-alpha",
    event: "document.update",
    payload: { ok: true },
    requestId: "req-4",
  });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(elapsedMs < 30, true);
  await new Promise((resolve) => setTimeout(resolve, 140));
  assert.deepEqual(
    audits.map((audit) => [audit.operationId, audit.decision, audit.status]),
    [["after-broken", "fail_open", "error"]],
  );
});
