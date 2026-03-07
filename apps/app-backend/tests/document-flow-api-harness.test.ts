import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const files = [
  "tests/harness/document-flow/api/smoke.mjs",
  "tests/harness/document-flow/api/comments.mjs",
  "tests/harness/document-flow/api/lock.mjs",
  "tests/harness/document-flow/api/_helpers/auth.mjs",
];

test("document-flow api harness files exist", () => {
  for (const relativePath of files) {
    assert.equal(existsSync(path.join(repoRoot, relativePath)), true, `${relativePath} should exist`);
  }
});
