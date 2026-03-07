import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { after, test } from "node:test";

const execFileAsync = promisify(execFile);

async function createFixture(): Promise<{
  root: string;
  matrixPath: string;
  migrationsRoot: string;
  sqlitePath: string;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zeus-migrate-status-cli-test-"));
  const migrationsRoot = path.join(root, "migrations");
  const matrixPath = path.join(root, "release-matrix.yaml");
  const sqlitePath = path.join(root, "mobile.sqlite3");

  const migrationDir = path.join(migrationsRoot, "mobile.sqlite", "20260301-001-v1.0.0");
  await fs.mkdir(migrationDir, { recursive: true });
  await fs.writeFile(
    path.join(migrationDir, "up.sql"),
    "CREATE TABLE docs (id TEXT PRIMARY KEY, title TEXT NOT NULL);",
    "utf8",
  );
  await fs.writeFile(path.join(migrationDir, "down.sql"), "DROP TABLE docs;", "utf8");

  await fs.writeFile(
    matrixPath,
    [
      "version: 1",
      "targets:",
      "  mobile:",
      "    - mobile.sqlite",
      "releases:",
      "  - app_version: v0.0.0",
      "    tracks:",
      "      mobile.sqlite: v0.0.0",
      "  - app_version: v1.0.0",
      "    tracks:",
      "      mobile.sqlite: v1.0.0",
      "",
    ].join("\n"),
    "utf8",
  );

  return { root, matrixPath, migrationsRoot, sqlitePath };
}

const fixture = await createFixture();

after(async () => {
  await fs.rm(fixture.root, { recursive: true, force: true });
});

async function runCli(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(
    "node",
    ["--import", "tsx", "src/scripts/migrate-manager.ts", ...args],
    { cwd: "/Users/darin/mine/code/zeus/apps/app-backend" },
  );
  return stdout;
}

test("status details shows pending upgrade before apply", async () => {
  const out = await runCli([
    "status",
    "--target",
    "mobile",
    "--to-app-version",
    "v1.0.0",
    "--matrix",
    fixture.matrixPath,
    "--migrations-root",
    fixture.migrationsRoot,
    "--sqlite-file",
    fixture.sqlitePath,
    "--details",
    "true",
  ]);

  const result = JSON.parse(out) as {
    tracks: string[];
    details: Array<{
      track: string;
      appliedMigrationIds: string[];
      pendingUpgradeMigrationIds: string[];
      pendingRollbackMigrationIds: string[];
    }>;
  };

  assert.deepEqual(result.tracks, ["mobile.sqlite"]);
  const detail = result.details.find((item) => item.track === "mobile.sqlite");
  assert.ok(detail);
  assert.deepEqual(detail.appliedMigrationIds, []);
  assert.deepEqual(detail.pendingUpgradeMigrationIds, ["20260301-001-v1.0.0"]);
  assert.deepEqual(detail.pendingRollbackMigrationIds, []);
});

test("status details shows pending rollback after apply", async () => {
  await runCli([
    "apply",
    "up",
    "--target",
    "mobile",
    "--to-app-version",
    "v1.0.0",
    "--matrix",
    fixture.matrixPath,
    "--migrations-root",
    fixture.migrationsRoot,
    "--sqlite-file",
    fixture.sqlitePath,
  ]);

  const out = await runCli([
    "status",
    "--target",
    "mobile",
    "--to-app-version",
    "v0.0.0",
    "--matrix",
    fixture.matrixPath,
    "--migrations-root",
    fixture.migrationsRoot,
    "--sqlite-file",
    fixture.sqlitePath,
    "--details",
    "true",
  ]);

  const result = JSON.parse(out) as {
    details: Array<{
      track: string;
      appliedMigrationIds: string[];
      pendingUpgradeMigrationIds: string[];
      pendingRollbackMigrationIds: string[];
    }>;
  };
  const detail = result.details.find((item) => item.track === "mobile.sqlite");
  assert.ok(detail);
  assert.deepEqual(detail.appliedMigrationIds, ["20260301-001-v1.0.0"]);
  assert.deepEqual(detail.pendingUpgradeMigrationIds, []);
  assert.deepEqual(detail.pendingRollbackMigrationIds, ["20260301-001-v1.0.0"]);
});
