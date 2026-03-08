import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();
const evalIndex = readFileSync(path.join(repoRoot, 'docs/evals/README.md'), 'utf8');
const gitignore = readFileSync(path.join(repoRoot, '.gitignore'), 'utf8');

test('cleanup script exists', () => {
  assert.equal(existsSync(path.join(repoRoot, 'scripts/dev/cleanup-debug-artifacts.mjs')), true);
});

test('eval docs distinguish stable harness output from debug output', () => {
  assert.match(evalIndex, /output\/harness/);
  assert.match(evalIndex, /output\/playwright/);
});

test('gitignore excludes local debug surfaces', () => {
  assert.match(gitignore, /\.playwright-cli\//);
});
