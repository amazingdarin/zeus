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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zeus-migrate-baseline-cli-test-"));
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

test("baseline marks migrations as applied without executing SQL", async () => {
  const baselineOut = await runCli([
    "baseline",
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

  const baselineResult = JSON.parse(baselineOut) as {
    mode: string;
    tracks: Array<{ track: string; status: string; markedMigrationIds: string[] }>;
  };
  assert.equal(baselineResult.mode, "baseline");
  const track = baselineResult.tracks.find((item) => item.track === "mobile.sqlite");
  assert.ok(track);
  assert.equal(track.status, "success");
  assert.deepEqual(track.markedMigrationIds, ["20260301-001-v1.0.0"]);

  const applyOut = await runCli([
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

  const applyResult = JSON.parse(applyOut) as {
    tracks: Array<{ track: string; appliedMigrationIds: string[] }>;
  };
  const applyTrack = applyResult.tracks.find((item) => item.track === "mobile.sqlite");
  assert.ok(applyTrack);
  assert.deepEqual(applyTrack.appliedMigrationIds, []);
});

test("baseline dry-run reports candidates without writing history", async () => {
  const sqliteDryRunPath = path.join(fixture.root, "mobile-dry-run.sqlite3");

  const baselineOut = await runCli([
    "baseline",
    "--target",
    "mobile",
    "--to-app-version",
    "v1.0.0",
    "--matrix",
    fixture.matrixPath,
    "--migrations-root",
    fixture.migrationsRoot,
    "--sqlite-file",
    sqliteDryRunPath,
    "--dry-run",
    "true",
  ]);

  const baselineResult = JSON.parse(baselineOut) as {
    tracks: Array<{ track: string; status: string; markedMigrationIds: string[] }>;
  };
  const track = baselineResult.tracks.find((item) => item.track === "mobile.sqlite");
  assert.ok(track);
  assert.equal(track.status, "success");
  assert.deepEqual(track.markedMigrationIds, ["20260301-001-v1.0.0"]);

  const applyOut = await runCli([
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
    sqliteDryRunPath,
  ]);
  const applyResult = JSON.parse(applyOut) as {
    tracks: Array<{ track: string; appliedMigrationIds: string[] }>;
  };
  const applyTrack = applyResult.tracks.find((item) => item.track === "mobile.sqlite");
  assert.ok(applyTrack);
  assert.deepEqual(applyTrack.appliedMigrationIds, ["20260301-001-v1.0.0"]);
});

test("baseline direction down marks rollback baseline and makes apply down a no-op", async () => {
  const sqliteDownBaselinePath = path.join(fixture.root, "mobile-down-baseline.sqlite3");

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
    sqliteDownBaselinePath,
  ]);

  const baselineOut = await runCli([
    "baseline",
    "--target",
    "mobile",
    "--to-app-version",
    "v0.0.0",
    "--matrix",
    fixture.matrixPath,
    "--migrations-root",
    fixture.migrationsRoot,
    "--sqlite-file",
    sqliteDownBaselinePath,
    "--direction",
    "down",
  ]);
  const baselineResult = JSON.parse(baselineOut) as {
    mode: string;
    direction: string;
    tracks: Array<{ track: string; status: string; markedMigrationIds: string[] }>;
  };
  assert.equal(baselineResult.mode, "baseline");
  assert.equal(baselineResult.direction, "down");
  const track = baselineResult.tracks.find((item) => item.track === "mobile.sqlite");
  assert.ok(track);
  assert.equal(track.status, "success");
  assert.deepEqual(track.markedMigrationIds, ["20260301-001-v1.0.0"]);

  const downOut = await runCli([
    "apply",
    "down",
    "--target",
    "mobile",
    "--to-app-version",
    "v0.0.0",
    "--matrix",
    fixture.matrixPath,
    "--migrations-root",
    fixture.migrationsRoot,
    "--sqlite-file",
    sqliteDownBaselinePath,
  ]);
  const downResult = JSON.parse(downOut) as {
    mode: string;
    tracks: Array<{ track: string; appliedMigrationIds: string[] }>;
  };
  assert.equal(downResult.mode, "down");
  const downTrack = downResult.tracks.find((item) => item.track === "mobile.sqlite");
  assert.ok(downTrack);
  assert.deepEqual(downTrack.appliedMigrationIds, []);
});
