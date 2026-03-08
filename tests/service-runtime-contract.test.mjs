import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

function runStatus() {
  const output = execFileSync('node', ['scripts/dev/service-runtime.mjs', 'status', '--json'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  return JSON.parse(output);
}

test('service runtime status exposes core services', () => {
  const data = runStatus();
  for (const key of ['server', 'app-backend', 'web']) {
    assert.ok(key in data.services, `${key} must be present`);
  }
  assert.equal(typeof data.runtimeDir, 'string');
});
