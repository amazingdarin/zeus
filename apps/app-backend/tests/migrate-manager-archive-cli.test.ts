import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { after, test } from "node:test";

const execFileAsync = promisify(execFile);

async function createFixture(): Promise<{ root: string; migrationsRoot: string; archiveRoot: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zeus-migrate-archive-cli-test-"));
  const migrationsRoot = path.join(root, "migrations");
  const archiveRoot = path.join(root, "archive");

  const dirs = [
    path.join(migrationsRoot, "mobile.sqlite", "20260301-001-v1.0.0"),
    path.join(migrationsRoot, "mobile.sqlite", "20260302-001-v1.1.0"),
    path.join(migrationsRoot, "server.postgres", "20260301-001-v1.0.0"),
  ];
  for (const dir of dirs) {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "up.sql"), "SELECT 1;", "utf8");
    await fs.writeFile(path.join(dir, "down.sql"), "SELECT 1;", "utf8");
  }

  return { root, migrationsRoot, archiveRoot };
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

test("archive moves migrations up to target schema version", async () => {
  const out = await runCli([
    "archive",
    "--before-schema-version",
    "v1.0.0",
    "--migrations-root",
    fixture.migrationsRoot,
    "--output",
    fixture.archiveRoot,
  ]);

  const result = JSON.parse(out) as {
    tracks: Array<{ track: string; archivedMigrationIds: string[]; status: string }>;
  };
  const mobile = result.tracks.find((item) => item.track === "mobile.sqlite");
  assert.ok(mobile);
  assert.equal(mobile.status, "success");
  assert.deepEqual(mobile.archivedMigrationIds, ["20260301-001-v1.0.0"]);

  const server = result.tracks.find((item) => item.track === "server.postgres");
  assert.ok(server);
  assert.equal(server.status, "success");
  assert.deepEqual(server.archivedMigrationIds, ["20260301-001-v1.0.0"]);

  await assert.rejects(
    fs.access(path.join(fixture.migrationsRoot, "mobile.sqlite", "20260301-001-v1.0.0")),
    /ENOENT/,
  );
  await fs.access(path.join(fixture.migrationsRoot, "mobile.sqlite", "20260302-001-v1.1.0"));
  await fs.access(path.join(fixture.archiveRoot, "mobile.sqlite", "20260301-001-v1.0.0", "up.sql"));
  await fs.access(path.join(fixture.archiveRoot, "server.postgres", "20260301-001-v1.0.0", "up.sql"));
});

test("archive dry-run only reports candidates", async () => {
  const out = await runCli([
    "archive",
    "--before-schema-version",
    "v1.1.0",
    "--migrations-root",
    fixture.migrationsRoot,
    "--output",
    fixture.archiveRoot,
    "--dry-run",
    "true",
    "--track",
    "mobile.sqlite",
  ]);

  const result = JSON.parse(out) as {
    tracks: Array<{ track: string; archivedMigrationIds: string[]; status: string }>;
  };
  assert.equal(result.tracks.length, 1);
  assert.equal(result.tracks[0]?.track, "mobile.sqlite");
  assert.equal(result.tracks[0]?.status, "success");
  assert.deepEqual(result.tracks[0]?.archivedMigrationIds, ["20260302-001-v1.1.0"]);

  await fs.access(path.join(fixture.migrationsRoot, "mobile.sqlite", "20260302-001-v1.1.0"));
});

test("archive strict mode exits non-zero when a track fails", async () => {
  await assert.rejects(
    execFileAsync(
      "node",
      [
        "--import",
        "tsx",
        "src/scripts/migrate-manager.ts",
        "archive",
        "--before-schema-version",
        "v1.0.0",
        "--migrations-root",
        fixture.migrationsRoot,
        "--output",
        fixture.archiveRoot,
        "--track",
        "missing.track",
        "--strict",
        "true",
      ],
      { cwd: "/Users/darin/mine/code/zeus/apps/app-backend" },
    ),
    /Archive failed/,
  );
});
