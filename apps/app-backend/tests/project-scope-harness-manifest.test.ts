import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const files = [
  "tests/harness/project-scope/README.md",
  "tests/harness/project-scope/api/README.md",
  "tests/harness/project-scope/api/auth-smoke.mjs",
  "tests/harness/project-scope/api/personal-scope.mjs",
  "tests/harness/project-scope/api/invalid-owner.mjs",
  "tests/fixtures/project-scope/README.md",
];

test("project scope harness files exist", () => {
  for (const relativePath of files) {
    assert.equal(existsSync(path.join(repoRoot, relativePath)), true, `${relativePath} should exist`);
  }
});
