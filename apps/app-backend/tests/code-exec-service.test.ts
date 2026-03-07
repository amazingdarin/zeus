import test from "node:test";
import assert from "node:assert/strict";
import type { Document } from "../src/storage/types.js";

import { createCodeExecService } from "../src/services/code-exec/service.js";

function buildDoc(): Document {
  return {
    meta: {
      id: "d1",
      schema_version: "v1",
      title: "Doc 1",
      slug: "doc-1",
      path: "d1.json",
      parent_id: "root",
      created_at: "2026-03-04T00:00:00.000Z",
      updated_at: "2026-03-04T00:00:00.000Z",
      extra: {},
    },
    body: {
      type: "tiptap",
      content: {
        type: "doc",
        content: [],
      },
    },
  };
}

test("run delegates to guard then code-runner client", async () => {
  let guardCalled = false;
  let executeCalled = false;

  const service = createCodeExecService({
    getDocument: async () => buildDoc(),
    guard: (input) => {
      guardCalled = true;
      assert.equal(input.blockId, "b1");
      return {
        blockId: "b1",
        language: "python",
        code: "print('ok')",
      };
    },
    client: {
      execute: async (input) => {
        executeCalled = true;
        assert.equal(input.blockId, "b1");
        assert.equal(input.language, "python");
        assert.equal(input.code, "print('ok')");
        return {
          runId: "run-1",
          status: "completed",
          result: {
            stdout: "ok",
            stderr: "",
            exitCode: 0,
            durationMs: 3,
            truncated: false,
            timedOut: false,
          },
        };
      },
      listRuns: async () => ({ items: [], nextCursor: "" }),
      getRun: async () => ({
        runId: "run-1",
        status: "completed",
        result: {
          stdout: "ok",
          stderr: "",
          exitCode: 0,
          durationMs: 3,
          truncated: false,
          timedOut: false,
        },
      }),
    },
    createRequestId: () => "req-fixed",
  });

  const out = await service.run({
    userId: "u1",
    ownerType: "personal",
    ownerId: "u1",
    projectKey: "p1",
    docId: "d1",
    blockId: "b1",
    language: "python",
    code: "print('ok')",
    timeoutMs: 10_000,
  });

  assert.equal(guardCalled, true);
  assert.equal(executeCalled, true);
  assert.equal(out.runId, "run-1");
});

test("list and get delegate to code-runner client", async () => {
  const service = createCodeExecService({
    getDocument: async () => buildDoc(),
    guard: () => ({
      blockId: "b1",
      language: "python",
      code: "print('ok')",
    }),
    client: {
      execute: async () => ({
        runId: "run-1",
        status: "completed",
        result: {
          stdout: "ok",
          stderr: "",
          exitCode: 0,
          durationMs: 3,
          truncated: false,
          timedOut: false,
        },
      }),
      listRuns: async (input) => {
        assert.equal(input.docId, "d1");
        assert.equal(input.blockId, "b1");
        return {
          items: [
            {
              runId: "run-1",
              status: "completed",
              result: {
                stdout: "ok",
                stderr: "",
                exitCode: 0,
                durationMs: 3,
                truncated: false,
                timedOut: false,
              },
            },
          ],
          nextCursor: "cursor-2",
        };
      },
      getRun: async (input) => {
        assert.equal(input.runId, "run-1");
        return {
          runId: "run-1",
          status: "completed",
          result: {
            stdout: "ok",
            stderr: "",
            exitCode: 0,
            durationMs: 3,
            truncated: false,
            timedOut: false,
          },
        };
      },
    },
    createRequestId: () => "req-fixed",
  });

  const list = await service.listRuns({
    ownerType: "personal",
    ownerId: "u1",
    projectKey: "p1",
    docId: "d1",
    blockId: "b1",
    cursor: "cursor-1",
    limit: 20,
  });
  assert.equal(list.items.length, 1);
  assert.equal(list.nextCursor, "cursor-2");

  const run = await service.getRun({
    ownerType: "personal",
    ownerId: "u1",
    projectKey: "p1",
    docId: "d1",
    runId: "run-1",
  });
  assert.equal(run.runId, "run-1");
});

