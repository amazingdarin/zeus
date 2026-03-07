import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createCodeExecState,
  reduceCodeExecState,
} from "../src/features/document-page/code-exec-state";

test("run-success event stores run metadata by block id", () => {
  const next = reduceCodeExecState(createCodeExecState(), {
    type: "run-success",
    blockId: "b1",
    runId: "r1",
    status: "completed",
  });

  assert.deepEqual(next, {
    b1: {
      running: false,
      lastRunId: "r1",
      lastStatus: "completed",
    },
  });
});

test("run-start then run-error keeps last run id and marks failed state", () => {
  const started = reduceCodeExecState(createCodeExecState(), {
    type: "run-start",
    blockId: "b2",
  });
  const failed = reduceCodeExecState(started, {
    type: "run-error",
    blockId: "b2",
  });

  assert.equal(failed.b2?.running, false);
  assert.equal(failed.b2?.lastStatus, "failed");
});
