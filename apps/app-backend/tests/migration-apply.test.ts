import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import type { MigrationPlan } from "../src/migrations/planner.ts";
import {
  applyMigrationPlan,
  collectAppliedMigrationsByTrack,
  type MigrationBackend,
} from "../src/migrations/apply.ts";

class FakeBackend implements MigrationBackend {
  readonly kind = "sqlite";

  private readonly applied = new Map<string, string[]>();
  private readonly locks = new Set<string>();
  private historyId = 0;
  readonly executedSql: string[] = [];
  readonly finished: Array<{ id: number; status: "success" | "failed"; error?: string }> = [];

  failContains: string | null = null;

  async ensureStateTables(): Promise<void> {}

  async listAppliedMigrations(track: string): Promise<string[]> {
    return [...(this.applied.get(track) ?? [])];
  }

  async acquireLock(track: string, _holder: string): Promise<void> {
    if (this.locks.has(track)) {
      throw new Error(`lock exists: ${track}`);
    }
    this.locks.add(track);
  }

  async releaseLock(track: string, _holder: string): Promise<void> {
    this.locks.delete(track);
  }

  async insertHistoryRunning(args: {
    track: string;
    migrationId: string;
    schemaVersion: string;
    appVersion: string;
    direction: "up" | "down";
    operator: string;
    checksumUp?: string;
    checksumDown?: string;
  }): Promise<number> {
    this.historyId += 1;
    void args;
    return this.historyId;
  }

  async updateHistoryResult(
    id: number,
    status: "success" | "failed",
    errorMessage?: string,
  ): Promise<void> {
    this.finished.push({ id, status, error: errorMessage });
  }

  async executeOperation(
    track: string,
    migrationId: string,
    direction: "up" | "down",
    sql: string,
  ): Promise<void> {
    this.executedSql.push(`${track}:${migrationId}:${sql}`);
    if (this.failContains && sql.includes(this.failContains)) {
      throw new Error(`fake sql failure: ${this.failContains}`);
    }
    const list = this.applied.get(track) ?? [];
    if (direction === "up") {
      if (!list.includes(migrationId)) {
        list.push(migrationId);
      }
      this.applied.set(track, list);
      return;
    }
    this.applied.set(
      track,
      list.filter((item) => item !== migrationId),
    );
  }
}

async function createMigrationDir(
  root: string,
  track: string,
  id: string,
  upSql: string,
  downSql: string,
): Promise<string> {
  const dir = path.join(root, track, id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "up.sql"), upSql, "utf8");
  await fs.writeFile(path.join(dir, "down.sql"), downSql, "utf8");
  return dir;
}

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zeus-migration-apply-test-"));

after(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

test("collectAppliedMigrationsByTrack only includes tracks with backend", async () => {
  const backend = new FakeBackend();
  await backend.executeOperation("mobile.sqlite", "20260301-001-v1.0.0", "up", "select 1");

  const map = await collectAppliedMigrationsByTrack(
    ["mobile.sqlite", "desktop.meili"],
    (track) => (track === "mobile.sqlite" ? backend : undefined),
  );
  assert.deepEqual(Object.keys(map), ["mobile.sqlite"]);
  assert.deepEqual(map["mobile.sqlite"], ["20260301-001-v1.0.0"]);
});

test("applyMigrationPlan applies SQL migrations and skips unsupported track", async () => {
  const backend = new FakeBackend();
  const m1 = await createMigrationDir(
    tempRoot,
    "mobile.sqlite",
    "20260301-001-v1.0.0",
    "CREATE TABLE t1(id INTEGER);",
    "DROP TABLE t1;",
  );

  const plan: MigrationPlan = {
    mode: "up",
    target: "mobile",
    appVersion: "v1.0.0",
    tracks: [
      {
        track: "mobile.sqlite",
        targetSchemaVersion: "v1.0.0",
        migrations: [
          {
            track: "mobile.sqlite",
            migrationId: "20260301-001-v1.0.0",
            schemaVersion: "v1.0.0",
            migrationPath: m1,
          },
        ],
      },
      {
        track: "desktop.meili",
        targetSchemaVersion: "v1.0.0",
        migrations: [],
      },
    ],
  };

  const result = await applyMigrationPlan({
    plan,
    operator: "test",
    backendResolver: (track) => (track === "mobile.sqlite" ? backend : undefined),
  });

  assert.equal(result.mode, "up");
  const mobileResult = result.tracks.find((item) => item.track === "mobile.sqlite");
  assert.ok(mobileResult);
  assert.deepEqual(mobileResult.appliedMigrationIds, ["20260301-001-v1.0.0"]);
  assert.equal(mobileResult.status, "success");

  const meiliResult = result.tracks.find((item) => item.track === "desktop.meili");
  assert.ok(meiliResult);
  assert.equal(meiliResult.status, "skipped");
  assert.match(meiliResult.message ?? "", /No backend configured/);
});

test("applyMigrationPlan records failed history and stops track on error", async () => {
  const backend = new FakeBackend();
  backend.failContains = "FAIL_NOW";
  const m1 = await createMigrationDir(
    tempRoot,
    "mobile.sqlite",
    "20260302-001-v1.1.0",
    "SELECT 1; -- FAIL_NOW",
    "SELECT 1;",
  );

  const plan: MigrationPlan = {
    mode: "up",
    target: "mobile",
    appVersion: "v1.1.0",
    tracks: [
      {
        track: "mobile.sqlite",
        targetSchemaVersion: "v1.1.0",
        migrations: [
          {
            track: "mobile.sqlite",
            migrationId: "20260302-001-v1.1.0",
            schemaVersion: "v1.1.0",
            migrationPath: m1,
          },
        ],
      },
    ],
  };

  const result = await applyMigrationPlan({
    plan,
    operator: "test",
    backendResolver: () => backend,
  });

  const trackResult = result.tracks[0];
  assert.ok(trackResult);
  assert.equal(trackResult.status, "failed");
  assert.match(trackResult.message ?? "", /fake sql failure/);
  assert.equal(backend.finished.some((item) => item.status === "failed"), true);
});
