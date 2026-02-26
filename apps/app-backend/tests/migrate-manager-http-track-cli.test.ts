import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";

const execFileAsync = promisify(execFile);

type RecordedRequest = {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
};

async function startRecorderServer(): Promise<{
  baseUrl: string;
  requests: RecordedRequest[];
  close: () => Promise<void>;
}> {
  const requests: RecordedRequest[] = [];

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => {
      requests.push({
        method: req.method ?? "GET",
        url: req.url ?? "/",
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true }));
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const addr = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    requests,
    close: async () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

async function createFixture(): Promise<{
  root: string;
  matrixPath: string;
  migrationsRoot: string;
  sqlitePath: string;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zeus-migrate-http-cli-test-"));
  const migrationsRoot = path.join(root, "migrations");
  const matrixPath = path.join(root, "release-matrix.yaml");
  const sqlitePath = path.join(root, "desktop.sqlite3");

  const sqliteMigration = path.join(migrationsRoot, "desktop.sqlite", "20260301-001-v1.0.0");
  await fs.mkdir(sqliteMigration, { recursive: true });
  await fs.writeFile(
    path.join(sqliteMigration, "up.sql"),
    "CREATE TABLE local_docs (id TEXT PRIMARY KEY);",
    "utf8",
  );
  await fs.writeFile(path.join(sqliteMigration, "down.sql"), "DROP TABLE local_docs;", "utf8");

  const qdrantMigration = path.join(migrationsRoot, "desktop.qdrant", "20260301-001-v1.0.0");
  await fs.mkdir(qdrantMigration, { recursive: true });
  await fs.writeFile(
    path.join(qdrantMigration, "up.http.json"),
    JSON.stringify(
      {
        requests: [
          {
            method: "PUT",
            path: "/collections/local_docs",
            body: {
              vectors: { size: 3, distance: "Cosine" },
            },
            expectStatus: [200, 201],
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );
  await fs.writeFile(
    path.join(qdrantMigration, "down.http.json"),
    JSON.stringify(
      {
        requests: [
          {
            method: "DELETE",
            path: "/collections/local_docs",
            expectStatus: [200, 202, 204],
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );

  const meiliMigration = path.join(migrationsRoot, "desktop.meili", "20260301-001-v1.0.0");
  await fs.mkdir(meiliMigration, { recursive: true });
  await fs.writeFile(
    path.join(meiliMigration, "up.http.json"),
    JSON.stringify(
      {
        requests: [
          {
            method: "POST",
            path: "/indexes",
            body: { uid: "local_docs", primaryKey: "id" },
            expectStatus: [200, 201, 202],
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );
  await fs.writeFile(
    path.join(meiliMigration, "down.http.json"),
    JSON.stringify(
      {
        requests: [
          {
            method: "DELETE",
            path: "/indexes/local_docs",
            expectStatus: [200, 202, 204],
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );

  await fs.writeFile(
    matrixPath,
    [
      "version: 1",
      "targets:",
      "  desktop:",
      "    - desktop.sqlite",
      "    - desktop.qdrant",
      "    - desktop.meili",
      "releases:",
      "  - app_version: v0.0.0",
      "    tracks:",
      "      desktop.sqlite: v0.0.0",
      "      desktop.qdrant: v0.0.0",
      "      desktop.meili: v0.0.0",
      "  - app_version: v1.0.0",
      "    tracks:",
      "      desktop.sqlite: v1.0.0",
      "      desktop.qdrant: v1.0.0",
      "      desktop.meili: v1.0.0",
      "",
    ].join("\n"),
    "utf8",
  );

  return { root, matrixPath, migrationsRoot, sqlitePath };
}

const fixture = await createFixture();
const qdrantServer = await startRecorderServer();
const meiliServer = await startRecorderServer();

after(async () => {
  await qdrantServer.close();
  await meiliServer.close();
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

test("apply up executes sqlite + qdrant + meili tracks", async () => {
  const stdout = await runCli([
    "apply",
    "up",
    "--target",
    "desktop",
    "--to-app-version",
    "v1.0.0",
    "--matrix",
    fixture.matrixPath,
    "--migrations-root",
    fixture.migrationsRoot,
    "--sqlite-file",
    fixture.sqlitePath,
    "--qdrant-url",
    qdrantServer.baseUrl,
    "--qdrant-api-key",
    "qdrant-secret",
    "--meili-url",
    meiliServer.baseUrl,
    "--meili-api-key",
    "meili-secret",
  ]);

  const result = JSON.parse(stdout) as {
    tracks: Array<{ track: string; status: string; appliedMigrationIds: string[] }>;
  };
  assert.equal(result.tracks.every((item) => item.status === "success"), true);
  assert.equal(qdrantServer.requests.length, 1);
  assert.equal(qdrantServer.requests[0]?.url, "/collections/local_docs");
  assert.equal(qdrantServer.requests[0]?.headers["api-key"], "qdrant-secret");
  assert.equal(meiliServer.requests.length, 1);
  assert.equal(meiliServer.requests[0]?.url, "/indexes");
  assert.equal(meiliServer.requests[0]?.headers.authorization, "Bearer meili-secret");
});

test("apply down executes rollback requests for qdrant + meili", async () => {
  const stdout = await runCli([
    "apply",
    "down",
    "--target",
    "desktop",
    "--to-app-version",
    "v0.0.0",
    "--matrix",
    fixture.matrixPath,
    "--migrations-root",
    fixture.migrationsRoot,
    "--sqlite-file",
    fixture.sqlitePath,
    "--qdrant-url",
    qdrantServer.baseUrl,
    "--qdrant-api-key",
    "qdrant-secret",
    "--meili-url",
    meiliServer.baseUrl,
    "--meili-api-key",
    "meili-secret",
  ]);

  const result = JSON.parse(stdout) as {
    mode: string;
    tracks: Array<{ track: string; status: string; appliedMigrationIds: string[] }>;
  };
  assert.equal(result.mode, "down");
  assert.equal(result.tracks.every((item) => item.status === "success"), true);
  assert.equal(
    qdrantServer.requests.some(
      (req) => req.method === "DELETE" && req.url === "/collections/local_docs",
    ),
    true,
  );
  assert.equal(
    meiliServer.requests.some((req) => req.method === "DELETE" && req.url === "/indexes/local_docs"),
    true,
  );
});

