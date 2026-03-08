import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();
const apiConfig = readFileSync(path.join(repoRoot, 'apps/web/src/config/api.ts'), 'utf8');
const agents = readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf8');

test('owner scope uses scoped project routes in web api config', () => {
  assert.match(apiConfig, /PROJECT_REF_SEPARATOR/);
  assert.match(apiConfig, /isScopedProjectPath/);
  assert.match(apiConfig, /encodeProjectRef\s*=\s*\(projectRef/);
});

test('root guidance documents owner scope anti-pattern', () => {
  assert.match(agents, /禁止.*project key/);
});
