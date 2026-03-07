import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  loadReleaseMatrixFromFile,
  resolveSchemaVersionForTrack,
  resolveTracksForTarget,
} from "../src/migrations/release-matrix.ts";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(THIS_DIR, "../../..");
const RELEASE_MATRIX_PATH = path.join(REPO_ROOT, "ddl/release-matrix.yaml");

test("loadReleaseMatrixFromFile loads matrix from ddl/release-matrix.yaml", async () => {
  const matrix = await loadReleaseMatrixFromFile(RELEASE_MATRIX_PATH);
  assert.equal(matrix.version, 1);
  assert.equal(Array.isArray(matrix.releases), true);
  assert.equal(matrix.releases.length > 0, true);
});

test("resolveTracksForTarget resolves configured tracks", async () => {
  const matrix = await loadReleaseMatrixFromFile(RELEASE_MATRIX_PATH);
  assert.deepEqual(resolveTracksForTarget(matrix, "desktop"), [
    "desktop.sqlite",
    "desktop.qdrant",
    "desktop.meili",
  ]);
});

test("resolveSchemaVersionForTrack resolves app version to track schema version", async () => {
  const matrix = await loadReleaseMatrixFromFile(RELEASE_MATRIX_PATH);
  assert.equal(resolveSchemaVersionForTrack(matrix, "v1.1.0", "server.postgres"), "v1.0.0");
});

test("resolveSchemaVersionForTrack throws for unknown app version", async () => {
  const matrix = await loadReleaseMatrixFromFile(RELEASE_MATRIX_PATH);
  assert.throws(
    () => resolveSchemaVersionForTrack(matrix, "v9.9.9", "server.postgres"),
    /App version not found/,
  );
});

