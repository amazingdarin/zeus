import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

test('worktree-env prints required runtime keys', () => {
  const output = execFileSync('node', ['scripts/dev/worktree-env.mjs', '--json'], {
    encoding: 'utf8',
    cwd: process.cwd(),
  });
  const data = JSON.parse(output);
  for (const key of ['worktreeName', 'ports', 'artifactRoot', 'seedNamespace']) {
    assert.ok(key in data, `${key} must be present`);
  }
  for (const portKey of ['web', 'appBackend', 'server']) {
    assert.ok(portKey in data.ports, `${portKey} port must be present`);
  }
});
