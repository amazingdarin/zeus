import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("app-backend .env does not commit an encryption key", () => {
  const text = read("apps/app-backend/.env");
  assert.doesNotMatch(text, /^ENCRYPTION_KEY=.+$/m);
});

test("project-scope seed does not hardcode team account passwords", () => {
  const text = read("scripts/dev/project-scope-seed.mjs");
  assert.doesNotMatch(text, /Playwright#2026!/);
});

test("harbor install does not default the admin password", () => {
  const text = read("deploy/harbor/install.sh");
  assert.doesNotMatch(text, /Harbor12345/);
});
