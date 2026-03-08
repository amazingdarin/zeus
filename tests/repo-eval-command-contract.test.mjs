import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();
const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const makefile = readFileSync(path.join(repoRoot, 'Makefile'), 'utf8');

test('package.json includes repo eval umbrella', () => {
  assert.equal(typeof pkg.scripts?.['eval:repo:smoke'], 'string');
});

test('Makefile includes repo-eval target', () => {
  assert.match(makefile, /^repo-eval:/m);
});
