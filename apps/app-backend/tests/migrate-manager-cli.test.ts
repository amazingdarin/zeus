import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { after, test } from "node:test";

const execFileAsync = promisify(execFile);

async function createFixture(): Promise<{ root: string; matrixPath: string; migrationsRoot: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zeus-migrate-cli-test-"));
  const migrationsRoot = path.join(root, "migrations");
  const matrixPath = path.join(root, "release-matrix.yaml");

  await fs.mkdir(path.join(migrationsRoot, "server.postgres", "20260301-001-v1.0.0"), { recursive: true });
  await fs.mkdir(path.join(migrationsRoot, "server.postgres", "20260302-001-v1.1.0"), { recursive: true });
  await fs.mkdir(path.join(migrationsRoot, "server.qdrant", "20260301-001-v1.0.0"), { recursive: true });

  await fs.writeFile(
    matrixPath,
    [
      "version: 1",
      "targets:",
      "  server:",
      "    - server.postgres",
      "    - server.qdrant",
      "releases:",
      "  - app_version: v1.0.0",
      "    tracks:",
      "      server.postgres: v1.0.0",
      "      server.qdrant: v1.0.0",
      "  - app_version: v1.1.0",
      "    tracks:",
      "      server.postgres: v1.0.0",
      "      server.qdrant: v1.0.0",
      "",
    ].join("\n"),
    "utf8",
  );

  return { root, matrixPath, migrationsRoot };
}

const fixture = await createFixture();

after(async () => {
  await fs.rm(fixture.root, { recursive: true, force: true });
});

test("CLI plan up outputs JSON plan", async () => {
  const { stdout } = await execFileAsync(
    "node",
    [
      "--import",
      "tsx",
      "src/scripts/migrate-manager.ts",
      "plan",
      "up",
      "--target",
      "server",
      "--to-app-version",
      "v1.1.0",
      "--matrix",
      fixture.matrixPath,
      "--migrations-root",
      fixture.migrationsRoot,
    ],
    {
      cwd: "/Users/darin/mine/code/zeus/apps/app-backend",
    },
  );

  const result = JSON.parse(stdout) as { mode: string; tracks: Array<{ track: string; migrations: Array<{ migrationId: string }> }> };
  assert.equal(result.mode, "up");
  const postgres = result.tracks.find((track) => track.track === "server.postgres");
  assert.ok(postgres);
  assert.deepEqual(postgres.migrations.map((item) => item.migrationId), ["20260301-001-v1.0.0"]);
});

test("CLI plan down outputs JSON rollback plan", async () => {
  const { stdout } = await execFileAsync(
    "node",
    [
      "--import",
      "tsx",
      "src/scripts/migrate-manager.ts",
      "plan",
      "down",
      "--target",
      "server",
      "--to-app-version",
      "v1.0.0",
      "--matrix",
      fixture.matrixPath,
      "--migrations-root",
      fixture.migrationsRoot,
      "--applied",
      JSON.stringify({
        "server.postgres": ["20260301-001-v1.0.0", "20260302-001-v1.1.0"],
      }),
    ],
    {
      cwd: "/Users/darin/mine/code/zeus/apps/app-backend",
    },
  );

  const result = JSON.parse(stdout) as { mode: string; tracks: Array<{ track: string; migrations: Array<{ migrationId: string }> }> };
  assert.equal(result.mode, "down");
  const postgres = result.tracks.find((track) => track.track === "server.postgres");
  assert.ok(postgres);
  assert.deepEqual(postgres.migrations.map((item) => item.migrationId), ["20260302-001-v1.1.0"]);
});

test("CLI validates required args", async () => {
  await assert.rejects(
    execFileAsync(
      "node",
      ["--import", "tsx", "src/scripts/migrate-manager.ts", "plan", "up"],
      { cwd: "/Users/darin/mine/code/zeus/apps/app-backend" },
    ),
    /Missing required option/,
  );
});

