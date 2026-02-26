import assert from "node:assert/strict";
import { after, test } from "node:test";

import { closePool, query } from "../src/db/postgres.ts";
import { messageCenterStore } from "../src/services/message-center-store.ts";

const ensureTable = async () => {
  await query(`
    CREATE TABLE IF NOT EXISTS message_center_tasks (
      id               TEXT PRIMARY KEY,
      user_id          TEXT NOT NULL,
      owner_type       TEXT NOT NULL DEFAULT 'personal',
      owner_id         TEXT NOT NULL DEFAULT '',
      project_key      TEXT NOT NULL,
      type             TEXT NOT NULL,
      title            TEXT NOT NULL,
      status           TEXT NOT NULL,
      progress_current INT NOT NULL DEFAULT 0,
      progress_total   INT NOT NULL DEFAULT 0,
      progress_percent INT NOT NULL DEFAULT 0,
      detail_json      JSONB NOT NULL DEFAULT '{}'::jsonb,
      error_message    TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      finished_at      TIMESTAMPTZ
    )
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_message_center_tasks_scope_status_updated
      ON message_center_tasks (user_id, owner_type, owner_id, project_key, status, updated_at DESC)
  `);
};

const canConnect = async (): Promise<boolean> => {
  try {
    await query("SELECT 1");
    return true;
  } catch {
    return false;
  }
};

const randomId = (prefix: string) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const cleanup = async (userId: string, projectKey: string) => {
  await query(
    `DELETE FROM message_center_tasks WHERE user_id = $1 AND project_key = $2`,
    [userId, projectKey],
  );
};

after(async () => {
  await closePool();
});

test("message-center list orders active and history by updated_at desc", async (t) => {
  if (!(await canConnect())) {
    t.skip("PostgreSQL not available");
    return;
  }
  await ensureTable();

  const userId = randomId("user");
  const projectKey = randomId("project");

  try {
    const taskA = await messageCenterStore.createTask({
      userId,
      projectKey,
      type: "import-git",
      title: "Task A",
      status: "pending",
    });
    await sleep(5);

    const taskB = await messageCenterStore.createTask({
      userId,
      projectKey,
      type: "import-git",
      title: "Task B",
      status: "running",
    });
    await sleep(5);

    await messageCenterStore.updateTaskProgress(userId, projectKey, taskA.id, {
      status: "running",
      current: 1,
      total: 5,
      percent: 20,
      message: "scan",
      phase: "scan",
    });
    await sleep(5);

    const taskC = await messageCenterStore.createTask({
      userId,
      projectKey,
      type: "import-git",
      title: "Task C",
      status: "pending",
    });
    await messageCenterStore.completeTask(userId, projectKey, taskC.id, {
      result: { files: 1 },
    });
    await sleep(5);

    const taskD = await messageCenterStore.createTask({
      userId,
      projectKey,
      type: "import-git",
      title: "Task D",
      status: "pending",
    });
    await messageCenterStore.failTask(userId, projectKey, taskD.id, "boom");

    const list = await messageCenterStore.listTasks(userId, projectKey, { limit: 10 });
    assert.equal(list.active.length, 2);
    assert.equal(list.active[0].id, taskA.id);
    assert.equal(list.active[1].id, taskB.id);

    assert.equal(list.history.length, 2);
    assert.equal(list.history[0].id, taskD.id);
    assert.equal(list.history[1].id, taskC.id);
  } finally {
    await cleanup(userId, projectKey);
  }
});

test("message-center updateTaskProgress persists progress", async (t) => {
  if (!(await canConnect())) {
    t.skip("PostgreSQL not available");
    return;
  }
  await ensureTable();

  const userId = randomId("user");
  const projectKey = randomId("project");

  try {
    const task = await messageCenterStore.createTask({
      userId,
      projectKey,
      type: "import-git",
      title: "Task Progress",
      status: "pending",
    });

    const updated = await messageCenterStore.updateTaskProgress(userId, projectKey, task.id, {
      status: "running",
      current: 3,
      total: 10,
      percent: 30,
      message: "importing",
      phase: "import",
    });

    assert(updated);
    if (!updated) return;

    assert.equal(updated.status, "running");
    assert.equal(updated.progress.current, 3);
    assert.equal(updated.progress.total, 10);
    assert.equal(updated.progress.percent, 30);
    assert.equal(updated.progress.message, "importing");
    assert.equal(updated.progress.phase, "import");

    const list = await messageCenterStore.listTasks(userId, projectKey, { limit: 10 });
    const item = list.active.find((row) => row.id === task.id);
    assert(item);
    assert.equal(item?.progress?.current, 3);
    assert.equal(item?.progress?.total, 10);
    assert.equal(item?.progress?.percent, 30);
    assert.equal(item?.progress?.message, "importing");
    assert.equal(item?.progress?.phase, "import");
  } finally {
    await cleanup(userId, projectKey);
  }
});

test("message-center timeout sweep marks stale active tasks failed", async (t) => {
  if (!(await canConnect())) {
    t.skip("PostgreSQL not available");
    return;
  }
  await ensureTable();

  const userId = randomId("user");
  const projectKey = randomId("project");

  try {
    const staleTask = await messageCenterStore.createTask({
      userId,
      projectKey,
      type: "import-folder",
      title: "Stale Task",
      status: "running",
    });
    const freshTask = await messageCenterStore.createTask({
      userId,
      projectKey,
      type: "import-folder",
      title: "Fresh Task",
      status: "running",
    });

    await query(
      `UPDATE message_center_tasks
          SET updated_at = now() - interval '2 hours'
        WHERE id = $1`,
      [staleTask.id],
    );

    const swept = await messageCenterStore.failTimedOutTasks({
      timeoutMs: 60 * 60 * 1000,
      errorMessage: "任务超时（监测器）",
      batchSize: 20,
    });

    assert.equal(swept.failed, 1);
    assert.equal(swept.tasks[0]?.id, staleTask.id);
    assert.equal(swept.tasks[0]?.status, "failed");
    assert.equal(swept.tasks[0]?.detail?.error, "任务超时（监测器）");

    const list = await messageCenterStore.listTasks(userId, projectKey, { limit: 10 });
    assert.equal(list.active.length, 1);
    assert.equal(list.active[0]?.id, freshTask.id);
    assert.equal(list.history.length, 1);
    assert.equal(list.history[0]?.id, staleTask.id);
    assert.equal(list.history[0]?.status, "failed");
  } finally {
    await cleanup(userId, projectKey);
  }
});
