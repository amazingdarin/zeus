import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { after, test } from "node:test";

const execFileAsync = promisify(execFile);

type Fixture = {
  root: string;
  matrixPath: string;
  migrationsRoot: string;
};

async function createFixture(): Promise<Fixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zeus-migrate-verify-cli-test-"));
  const migrationsRoot = path.join(root, "migrations");
  const matrixPath = path.join(root, "release-matrix.yaml");

  await fs.mkdir(path.join(migrationsRoot, "mobile.sqlite", "20260301-001-v1.0.0"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(migrationsRoot, "mobile.sqlite", "20260301-001-v1.0.0", "up.sql"),
    "CREATE TABLE t(id TEXT PRIMARY KEY);",
    "utf8",
  );
  await fs.writeFile(
    path.join(migrationsRoot, "mobile.sqlite", "20260301-001-v1.0.0", "down.sql"),
    "DROP TABLE t;",
    "utf8",
  );

  await fs.mkdir(path.join(migrationsRoot, "server.qdrant", "20260301-001-v1.0.0"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(migrationsRoot, "server.qdrant", "20260301-001-v1.0.0", "up.http.json"),
    JSON.stringify({ requests: [{ method: "PUT", path: "/collections/t" }] }),
    "utf8",
  );
  await fs.writeFile(
    path.join(migrationsRoot, "server.qdrant", "20260301-001-v1.0.0", "down.http.json"),
    JSON.stringify({ requests: [{ method: "DELETE", path: "/collections/t" }] }),
    "utf8",
  );

  await fs.writeFile(
    matrixPath,
    [
      "version: 1",
      "targets:",
      "  mobile:",
      "    - mobile.sqlite",
      "  server:",
      "    - server.qdrant",
      "releases:",
      "  - app_version: v1.0.0",
      "    tracks:",
      "      mobile.sqlite: v1.0.0",
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

async function runCli(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(
    "node",
    ["--import", "tsx", "src/scripts/migrate-manager.ts", ...args],
    { cwd: "/Users/darin/mine/code/zeus/apps/app-backend" },
  );
  return stdout;
}

test("verify passes when matrix and migration files are consistent", async () => {
  const stdout = await runCli([
    "verify",
    "--matrix",
    fixture.matrixPath,
    "--migrations-root",
    fixture.migrationsRoot,
  ]);

  const result = JSON.parse(stdout) as {
    status: string;
    findings: unknown[];
    checkedTracks: string[];
  };
  assert.equal(result.status, "passed");
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.checkedTracks, ["mobile.sqlite", "server.qdrant"]);
});

test("verify reports missing required migration files", async () => {
  await fs.rm(path.join(fixture.migrationsRoot, "mobile.sqlite", "20260301-001-v1.0.0", "down.sql"));

  const stdout = await runCli([
    "verify",
    "--matrix",
    fixture.matrixPath,
    "--migrations-root",
    fixture.migrationsRoot,
    "--track",
    "mobile.sqlite",
  ]);

  const result = JSON.parse(stdout) as {
    status: string;
    findings: Array<{ code: string; message: string }>;
  };
  assert.equal(result.status, "failed");
  assert.equal(
    result.findings.some((finding) => finding.code === "missing_operation_file" && /down\.sql/.test(finding.message)),
    true,
  );
});

test("verify reports release matrix track mapping gaps", async () => {
  const brokenMatrixPath = path.join(fixture.root, "release-matrix-broken.yaml");
  await fs.writeFile(
    brokenMatrixPath,
    [
      "version: 1",
      "targets:",
      "  server:",
      "    - server.qdrant",
      "releases:",
      "  - app_version: v1.0.0",
      "    tracks:",
      "      mobile.sqlite: v1.0.0",
      "",
    ].join("\n"),
    "utf8",
  );

  const stdout = await runCli([
    "verify",
    "--matrix",
    brokenMatrixPath,
    "--migrations-root",
    fixture.migrationsRoot,
    "--target",
    "server",
  ]);

  const result = JSON.parse(stdout) as {
    status: string;
    findings: Array<{ code: string; message: string }>;
  };
  assert.equal(result.status, "failed");
  assert.equal(
    result.findings.some(
      (finding) => finding.code === "missing_track_schema_version" && /server\.qdrant/.test(finding.message),
    ),
    true,
  );
});

test("verify strict mode exits non-zero when findings exist", async () => {
  const brokenMatrixPath = path.join(fixture.root, "release-matrix-strict-broken.yaml");
  await fs.writeFile(
    brokenMatrixPath,
    [
      "version: 1",
      "targets:",
      "  server:",
      "    - server.qdrant",
      "releases:",
      "  - app_version: v1.0.0",
      "    tracks:",
      "      mobile.sqlite: v1.0.0",
      "",
    ].join("\n"),
    "utf8",
  );

  await assert.rejects(
    execFileAsync(
      "node",
      [
        "--import",
        "tsx",
        "src/scripts/migrate-manager.ts",
        "verify",
        "--matrix",
        brokenMatrixPath,
        "--migrations-root",
        fixture.migrationsRoot,
        "--target",
        "server",
        "--strict",
        "true",
      ],
      { cwd: "/Users/darin/mine/code/zeus/apps/app-backend" },
    ),
    /Verification failed/,
  );
});
