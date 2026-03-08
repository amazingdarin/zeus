import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();
const files = [
  'docs/architecture/README.md',
  'docs/evals/README.md',
  'docs/architecture/document-flow.md',
  'docs/evals/document-flow.md',
  'docs/architecture/chat.md',
  'docs/evals/chat.md',
  'docs/architecture/project-scope.md',
  'docs/evals/project-scope.md',
  'docs/architecture/plugins.md',
  'docs/evals/plugins.md',
];

test('domain docs required by harness engineering exist', () => {
  for (const relativePath of files) {
    assert.equal(existsSync(path.join(repoRoot, relativePath)), true, `${relativePath} should exist`);
  }
});
