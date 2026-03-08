import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();
const files = [
  'docs/architecture/chat.md',
  'docs/architecture/project-scope.md',
  'docs/architecture/plugins.md',
  'docs/evals/chat.md',
  'docs/evals/project-scope.md',
  'docs/evals/plugins.md',
];

test('domain architecture and eval docs exist', () => {
  for (const relativePath of files) {
    assert.equal(existsSync(path.join(repoRoot, relativePath)), true, `${relativePath} should exist`);
  }
});
