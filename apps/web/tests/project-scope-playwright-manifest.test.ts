import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const files = [
  "tests/harness/project-scope/playwright/README.md",
  "tests/harness/project-scope/playwright/personal-project-ref.mjs",
  "tests/harness/project-scope/playwright/team-project-ref.mjs",
];

test("project-scope playwright harness files exist", () => {
  for (const relativePath of files) {
    assert.equal(existsSync(path.join(repoRoot, relativePath)), true, `${relativePath} should exist`);
  }
});
