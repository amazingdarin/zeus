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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zeus-migrate-apply-cli-test-"));
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
  await fs.writeFile(
    path.join(migrationDir, "down.sql"),
    "DROP TABLE docs;",
    "utf8",
  );

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

test("apply up executes sqlite migration and writes history", async () => {
  const stdout = await runCli([
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

  const result = JSON.parse(stdout) as {
    mode: string;
    tracks: Array<{ track: string; status: string; appliedMigrationIds: string[] }>;
  };
  assert.equal(result.mode, "up");
  const sqliteTrack = result.tracks.find((item) => item.track === "mobile.sqlite");
  assert.ok(sqliteTrack);
  assert.equal(sqliteTrack.status, "success");
  assert.deepEqual(sqliteTrack.appliedMigrationIds, ["20260301-001-v1.0.0"]);

  const sqliteModule = (await import("node:sqlite")) as {
    DatabaseSync: new (file: string) => {
      prepare: (sql: string) => { get: (...args: unknown[]) => Record<string, unknown> | undefined };
      close: () => void;
    };
  };
  const db = new sqliteModule.DatabaseSync(fixture.sqlitePath);
  try {
    const tableRow = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'docs'")
      .get();
    assert.ok(tableRow);
    const historyRow = db
      .prepare(
        "SELECT migration_id, status FROM zeus_migration_history WHERE track = ? ORDER BY id DESC LIMIT 1",
      )
      .get("mobile.sqlite") as { migration_id?: string; status?: string } | undefined;
    assert.equal(historyRow?.migration_id, "20260301-001-v1.0.0");
    assert.equal(historyRow?.status, "success");
  } finally {
    db.close();
  }
});

test("apply up again is idempotent", async () => {
  const stdout = await runCli([
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

  const result = JSON.parse(stdout) as {
    tracks: Array<{ track: string; appliedMigrationIds: string[] }>;
  };
  const sqliteTrack = result.tracks.find((item) => item.track === "mobile.sqlite");
  assert.ok(sqliteTrack);
  assert.deepEqual(sqliteTrack.appliedMigrationIds, []);
});

test("apply down rolls migration back by app version target", async () => {
  const stdout = await runCli([
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
    fixture.sqlitePath,
  ]);

  const result = JSON.parse(stdout) as {
    mode: string;
    tracks: Array<{ track: string; status: string; appliedMigrationIds: string[] }>;
  };
  assert.equal(result.mode, "down");
  const sqliteTrack = result.tracks.find((item) => item.track === "mobile.sqlite");
  assert.ok(sqliteTrack);
  assert.equal(sqliteTrack.status, "success");
  assert.deepEqual(sqliteTrack.appliedMigrationIds, ["20260301-001-v1.0.0"]);
});

test("apply down is idempotent after migration already rolled back", async () => {
  const stdout = await runCli([
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
    fixture.sqlitePath,
  ]);

  const result = JSON.parse(stdout) as {
    mode: string;
    tracks: Array<{ track: string; status: string; appliedMigrationIds: string[] }>;
  };
  assert.equal(result.mode, "down");
  const sqliteTrack = result.tracks.find((item) => item.track === "mobile.sqlite");
  assert.ok(sqliteTrack);
  assert.equal(sqliteTrack.status, "success");
  assert.deepEqual(sqliteTrack.appliedMigrationIds, []);
});
