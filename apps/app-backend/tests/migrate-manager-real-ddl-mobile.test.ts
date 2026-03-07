import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { after, test } from "node:test";

const execFileAsync = promisify(execFile);

const sqlitePath = path.join(os.tmpdir(), `zeus-real-ddl-mobile-${Date.now()}.sqlite3`);

after(async () => {
  await fs.rm(sqlitePath, { force: true });
});

async function runCli(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(
    "node",
    ["--import", "tsx", "src/scripts/migrate-manager.ts", ...args],
    { cwd: "/Users/darin/mine/code/zeus/apps/app-backend" },
  );
  return stdout;
}

test("real ddl mobile sqlite migration can apply up and rollback down", async () => {
  const upOut = await runCli([
    "apply",
    "up",
    "--target",
    "mobile",
    "--to-app-version",
    "v1.0.0",
    "--sqlite-file",
    sqlitePath,
  ]);

  const upResult = JSON.parse(upOut) as {
    tracks: Array<{ track: string; status: string; appliedMigrationIds: string[] }>;
  };
  const mobileUp = upResult.tracks.find((item) => item.track === "mobile.sqlite");
  assert.ok(mobileUp);
  assert.equal(mobileUp.status, "success");
  assert.deepEqual(mobileUp.appliedMigrationIds, ["20260301-001-v1.0.0"]);

  const downOut = await runCli([
    "apply",
    "down",
    "--target",
    "mobile",
    "--to-app-version",
    "v0.0.0",
    "--sqlite-file",
    sqlitePath,
  ]);

  const downResult = JSON.parse(downOut) as {
    tracks: Array<{ track: string; status: string; appliedMigrationIds: string[] }>;
  };
  const mobileDown = downResult.tracks.find((item) => item.track === "mobile.sqlite");
  assert.ok(mobileDown);
  assert.equal(mobileDown.status, "success");
  assert.deepEqual(mobileDown.appliedMigrationIds, ["20260301-001-v1.0.0"]);
});
