import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const MIGRATION_ID = "20260301-001-v1.0.0";
const SQL_TRACKS = ["mobile.sqlite", "desktop.sqlite", "server.postgres"] as const;
const HTTP_TRACKS = ["desktop.qdrant", "desktop.meili", "server.qdrant", "server.meili"] as const;

function repoRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../..");
}

async function listTrackMigrationDirs(track: string): Promise<string[]> {
  const trackDir = path.join(repoRoot(), "ddl", "migrations", track);
  const entries = await fs.readdir(trackDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

test("ddl migrations are consolidated to single v1.0.0 migration per track", async () => {
  for (const track of [...SQL_TRACKS, ...HTTP_TRACKS]) {
    const dirs = await listTrackMigrationDirs(track);
    assert.deepEqual(dirs, [MIGRATION_ID], `unexpected migration dirs for ${track}`);
  }
});

test("sql tracks contain up.sql/down.sql and user tables only exist on server.postgres", async () => {
  const root = repoRoot();

  for (const track of SQL_TRACKS) {
    const migrationRoot = path.join(root, "ddl", "migrations", track, MIGRATION_ID);
    await fs.access(path.join(migrationRoot, "up.sql"));
    await fs.access(path.join(migrationRoot, "down.sql"));
  }

  const mobileUp = await fs.readFile(
    path.join(root, "ddl", "migrations", "mobile.sqlite", MIGRATION_ID, "up.sql"),
    "utf8",
  );
  const serverUp = await fs.readFile(
    path.join(root, "ddl", "migrations", "server.postgres", MIGRATION_ID, "up.sql"),
    "utf8",
  );

  assert.match(serverUp, /CREATE TABLE IF NOT EXISTS "user"/);
  assert.doesNotMatch(mobileUp, /CREATE TABLE IF NOT EXISTS "user"/);

  assert.match(serverUp, /CREATE TABLE project/i);
  assert.match(mobileUp, /CREATE TABLE project/i);
  assert.match(serverUp, /CREATE TABLE(?: IF NOT EXISTS)? knowledge_index/i);
  assert.match(mobileUp, /CREATE TABLE(?: IF NOT EXISTS)? knowledge_index/i);
});

test("http tracks contain up.http.json/down.http.json", async () => {
  const root = repoRoot();
  for (const track of HTTP_TRACKS) {
    const migrationRoot = path.join(root, "ddl", "migrations", track, MIGRATION_ID);
    await fs.access(path.join(migrationRoot, "up.http.json"));
    await fs.access(path.join(migrationRoot, "down.http.json"));
  }
});
