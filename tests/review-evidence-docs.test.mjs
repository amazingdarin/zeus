import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();

test('review evidence runbooks exist', () => {
  assert.equal(existsSync(path.join(repoRoot, 'docs/runbooks/review-with-harness-evidence.md')), true);
  assert.equal(existsSync(path.join(repoRoot, 'docs/runbooks/merge-readiness.md')), true);
});

test('AGENTS links to review runbooks', () => {
  const agents = readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf8');
  assert.match(agents, /docs\/runbooks\/review-with-harness-evidence\.md/);
  assert.match(agents, /docs\/runbooks\/merge-readiness\.md/);
});
