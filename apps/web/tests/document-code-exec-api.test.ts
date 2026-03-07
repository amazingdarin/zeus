import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCodeExecRunPath,
  mapDocumentCodeRun,
} from "../src/api/documents";

test("buildCodeExecRunPath uses scoped project route", () => {
  const path = buildCodeExecRunPath("personal::me::p1", "d1");
  assert.equal(path, "/api/projects/personal/me/p1/documents/d1/code-exec/run");
});

test("mapDocumentCodeRun normalizes response shape", () => {
  const run = mapDocumentCodeRun({
    runId: "run-1",
    status: "completed",
    result: {
      stdout: "ok",
      stderr: "",
      exitCode: 0,
      durationMs: 5,
      truncated: false,
      timedOut: false,
    },
  });

  assert.equal(run.runId, "run-1");
  assert.equal(run.status, "completed");
  assert.equal(run.result.exitCode, 0);
});

