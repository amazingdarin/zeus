import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const MIGRATION_ID = "20260301-001-v1.0.0";

function repoRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../..");
}

async function read(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf8");
}

test("sql init snapshots are aligned with unified v1.0.0 migrations", async () => {
  const root = repoRoot();

  const serverInit = await read(path.join(root, "ddl", "sql", "init.server.postgres.sql"));
  const compatInit = await read(path.join(root, "ddl", "sql", "init.sql"));
  const mobileInit = await read(path.join(root, "ddl", "sql", "init.mobile.sqlite.sql"));
  const desktopInit = await read(path.join(root, "ddl", "sql", "init.desktop.sqlite.sql"));

  const serverMigrationUp = await read(
    path.join(root, "ddl", "migrations", "server.postgres", MIGRATION_ID, "up.sql"),
  );
  const mobileMigrationUp = await read(
    path.join(root, "ddl", "migrations", "mobile.sqlite", MIGRATION_ID, "up.sql"),
  );
  const desktopMigrationUp = await read(
    path.join(root, "ddl", "migrations", "desktop.sqlite", MIGRATION_ID, "up.sql"),
  );

  assert.equal(serverInit, serverMigrationUp);
  assert.equal(compatInit, serverMigrationUp);
  assert.equal(mobileInit, mobileMigrationUp);
  assert.equal(desktopInit, desktopMigrationUp);
});
