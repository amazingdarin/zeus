import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const files = [
  "tests/harness/document-flow/playwright/smoke-login-documents.js",
  "tests/harness/document-flow/playwright/title-sync.js",
  "tests/harness/document-flow/playwright/tabs-restore.js",
  "tests/harness/document-flow/playwright/comments.js",
  "tests/harness/document-flow/playwright/lock.js",
  "tests/harness/document-flow/playwright/i18n.js",
  "tests/harness/document-flow/playwright/ppt-context.js",
  "tests/harness/document-flow/playwright/_helpers/account.js",
];

test("document-flow playwright harness files exist", () => {
  for (const relativePath of files) {
    assert.equal(existsSync(path.join(repoRoot, relativePath)), true, `${relativePath} should exist`);
  }
});
