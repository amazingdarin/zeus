import test from "node:test";
import assert from "node:assert/strict";

import { createCodeExecClient } from "../src/services/code-exec/client.js";

test("code-exec client sends internal token and normalizes execute response", async () => {
  let seenToken = "";
  const client = createCodeExecClient({
    baseUrl: "http://runner.internal",
    internalToken: "runner-token",
    fetchImpl: async (_url, init) => {
      seenToken = String((init?.headers as Record<string, string>)["x-code-runner-token"] ?? "");
      return new Response(
        JSON.stringify({
          code: "OK",
          data: {
            runId: "run-1",
            status: "completed",
            result: {
              stdout: "ok",
              stderr: "",
              exitCode: 0,
              durationMs: 12,
              truncated: false,
              timedOut: false,
            },
          },
        }),
        { status: 200 },
      );
    },
  });

  const output = await client.execute({
    requestId: "req-1",
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

  assert.equal(seenToken, "runner-token");
  assert.equal(output.runId, "run-1");
  assert.equal(output.status, "completed");
  assert.equal(output.result.exitCode, 0);
});

test("code-exec client maps failed response to typed error", async () => {
  const client = createCodeExecClient({
    baseUrl: "http://runner.internal",
    internalToken: "runner-token",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          code: "EXEC_TIMEOUT",
          message: "execution timed out",
        }),
        { status: 504 },
      ),
  });

  await assert.rejects(
    () =>
      client.execute({
        requestId: "req-2",
        userId: "u1",
        ownerType: "personal",
        ownerId: "u1",
        projectKey: "p1",
        docId: "d1",
        blockId: "b1",
        language: "python",
        code: "print('ok')",
        timeoutMs: 10_000,
      }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal((err as { name?: string }).name, "CodeExecClientError");
      assert.equal((err as { status?: number }).status, 504);
      assert.equal((err as { code?: string }).code, "EXEC_TIMEOUT");
      return true;
    },
  );
});

test("code-exec client normalizes list/get payloads", async () => {
  const urls: string[] = [];
  const client = createCodeExecClient({
    baseUrl: "http://runner.internal",
    internalToken: "runner-token",
    fetchImpl: async (url) => {
      urls.push(String(url));
      if (String(url).includes("/runs?")) {
        return new Response(
          JSON.stringify({
            code: "OK",
            data: {
              items: [
                {
                  runId: "run-1",
                  status: "completed",
                  result: {
                    stdout: "ok",
                    stderr: "",
                    exitCode: 0,
                    durationMs: 10,
                    truncated: false,
                    timedOut: false,
                  },
                },
              ],
              nextCursor: "cursor-2",
            },
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          code: "OK",
          data: {
            runId: "run-1",
            status: "completed",
            result: {
              stdout: "ok",
              stderr: "",
              exitCode: 0,
              durationMs: 10,
              truncated: false,
              timedOut: false,
            },
          },
        }),
        { status: 200 },
      );
    },
  });

  const list = await client.listRuns({
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

  const one = await client.getRun({
    ownerType: "personal",
    ownerId: "u1",
    projectKey: "p1",
    docId: "d1",
    runId: "run-1",
  });
  assert.equal(one.runId, "run-1");
  assert.ok(urls.some((entry) => entry.includes("/internal/code-exec/runs?")));
  assert.ok(urls.some((entry) => entry.includes("/internal/code-exec/runs/run-1")));
});

