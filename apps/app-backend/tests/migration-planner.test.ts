import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import type { ReleaseMatrix } from "../src/migrations/types.ts";
import { planRollback, planUpgrade } from "../src/migrations/planner.ts";

async function mkdirp(filePath: string): Promise<void> {
  await fs.mkdir(filePath, { recursive: true });
}

async function createTrackMigration(
  root: string,
  track: string,
  migrationId: string,
): Promise<void> {
  const dir = path.join(root, track, migrationId);
  await mkdirp(dir);
  await fs.writeFile(path.join(dir, "manifest.yaml"), `id: ${migrationId}\n`, "utf8");
}

const TMP_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "zeus-migration-planner-test-"));
const MIGRATIONS_ROOT = path.join(TMP_DIR, "migrations");

const MATRIX: ReleaseMatrix = {
  version: 1,
  targets: {
    server: ["server.postgres", "server.qdrant"],
  },
  releases: [
    {
      app_version: "v1.0.0",
      tracks: {
        "server.postgres": "v1.0.0",
        "server.qdrant": "v1.0.0",
      },
    },
    {
      app_version: "v1.1.0",
      tracks: {
        "server.postgres": "v1.0.0",
        "server.qdrant": "v1.0.0",
      },
    },
  ],
};

await createTrackMigration(MIGRATIONS_ROOT, "server.postgres", "20260301-001-v1.0.0");
await createTrackMigration(MIGRATIONS_ROOT, "server.postgres", "20260302-001-v1.1.0");
await createTrackMigration(MIGRATIONS_ROOT, "server.qdrant", "20260301-001-v1.0.0");

after(async () => {
  await fs.rm(TMP_DIR, { recursive: true, force: true });
});

test("planUpgrade selects migrations up to target schema version", async () => {
  const plan = await planUpgrade({
    matrix: MATRIX,
    migrationsRoot: MIGRATIONS_ROOT,
    target: "server",
    appVersion: "v1.1.0",
  });

  const postgresTrack = plan.tracks.find((t) => t.track === "server.postgres");
  assert.ok(postgresTrack);
  assert.deepEqual(
    postgresTrack.migrations.map((item) => item.migrationId),
    ["20260301-001-v1.0.0"],
  );
});

test("planUpgrade excludes already-applied migrations", async () => {
  const plan = await planUpgrade({
    matrix: MATRIX,
    migrationsRoot: MIGRATIONS_ROOT,
    target: "server",
    appVersion: "v1.1.0",
    appliedMigrationIdsByTrack: {
      "server.postgres": ["20260301-001-v1.0.0"],
    },
  });

  const postgresTrack = plan.tracks.find((t) => t.track === "server.postgres");
  assert.ok(postgresTrack);
  assert.deepEqual(postgresTrack.migrations, []);
});

test("planRollback selects applied migrations above target schema in reverse order", async () => {
  const plan = await planRollback({
    matrix: MATRIX,
    migrationsRoot: MIGRATIONS_ROOT,
    target: "server",
    appVersion: "v1.0.0",
    appliedMigrationIdsByTrack: {
      "server.postgres": ["20260301-001-v1.0.0", "20260302-001-v1.1.0"],
    },
  });

  const postgresTrack = plan.tracks.find((t) => t.track === "server.postgres");
  assert.ok(postgresTrack);
  assert.deepEqual(
    postgresTrack.migrations.map((item) => item.migrationId),
    ["20260302-001-v1.1.0"],
  );
});

test("planUpgrade supports track filter", async () => {
  const plan = await planUpgrade({
    matrix: MATRIX,
    migrationsRoot: MIGRATIONS_ROOT,
    target: "server",
    track: "server.qdrant",
    appVersion: "v1.1.0",
  });

  assert.deepEqual(plan.tracks.map((t) => t.track), ["server.qdrant"]);
});

