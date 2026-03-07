import assert from "node:assert/strict";
import { test } from "node:test";

import { createSaveScheduler } from "../src/features/document-editor/save-scheduler";

test("scheduler coalesces rapid changes into latest payload", async () => {
  const calls: string[] = [];
  const scheduler = createSaveScheduler({
    debounceMs: 20,
    save: async (payload: string) => {
      calls.push(payload);
    },
  });

  scheduler.schedule("v1");
  scheduler.schedule("v2");
  scheduler.schedule("v3");
  await scheduler.flush();

  assert.deepEqual(calls, ["v3"]);
});

test("scheduler saves latest payload after in-flight save completes", async () => {
  const calls: string[] = [];
  let releaseFirstSave: (() => void) | null = null;
  const firstSaveBlocked = new Promise<void>((resolve) => {
    releaseFirstSave = resolve;
  });

  const scheduler = createSaveScheduler({
    debounceMs: 0,
    save: async (payload: string) => {
      calls.push(payload);
      if (payload === "v1") {
        await firstSaveBlocked;
      }
    },
  });

  scheduler.schedule("v1");
  await new Promise((resolve) => setTimeout(resolve, 0));
  scheduler.schedule("v2");

  releaseFirstSave?.();
  await scheduler.flush();

  assert.deepEqual(calls, ["v1", "v2"]);
});
