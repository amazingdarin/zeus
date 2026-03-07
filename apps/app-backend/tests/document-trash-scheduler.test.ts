import assert from "node:assert/strict";
import { test } from "node:test";

import { startDocumentTrashCleanupScheduler } from "../src/services/document-trash/scheduler.ts";

test("document-trash-scheduler: skips sweep when user setting disabled", async () => {
  const calls: Array<{ userId: string; projectKey: string; maxAgeDays: number }> = [];
  const stop = startDocumentTrashCleanupScheduler({
    intervalMs: 10,
    listTargets: async () => [
      { userId: "u1", projectKey: "personal::u1::p1" },
      { userId: "u1", projectKey: "personal::u1::p2" },
    ],
    getSettings: async () => ({
      trashAutoCleanupEnabled: false,
      trashAutoCleanupDays: 30,
    }),
    sweepProject: async (input) => {
      calls.push(input);
      return { count: 0 };
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 25));
  stop();

  assert.equal(calls.length, 0);
});

test("document-trash-scheduler: sweeps all projects with configured days", async () => {
  const calls: Array<{ userId: string; projectKey: string; maxAgeDays: number }> = [];
  const stop = startDocumentTrashCleanupScheduler({
    intervalMs: 10,
    listTargets: async () => [
      { userId: "u1", projectKey: "personal::u1::p1" },
      { userId: "u1", projectKey: "team::team-a::p2" },
      { userId: "u2", projectKey: "personal::u2::p3" },
    ],
    getSettings: async (userId) => ({
      trashAutoCleanupEnabled: true,
      trashAutoCleanupDays: userId === "u1" ? 45 : 7,
    }),
    sweepProject: async (input) => {
      calls.push(input);
      return { count: 1 };
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 25));
  stop();

  assert.equal(calls.length > 0, true);
  assert.equal(calls.some((call) => call.projectKey === "personal::u1::p1" && call.maxAgeDays === 45), true);
  assert.equal(calls.some((call) => call.projectKey === "team::team-a::p2" && call.maxAgeDays === 45), true);
  assert.equal(calls.some((call) => call.projectKey === "personal::u2::p3" && call.maxAgeDays === 7), true);
});
