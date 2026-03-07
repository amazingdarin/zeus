import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const files = [
  "tests/harness/document-flow/playwright/smoke-login-documents.mjs",
  "tests/harness/document-flow/playwright/title-sync.mjs",
  "tests/harness/document-flow/playwright/tabs-restore.mjs",
  "tests/harness/document-flow/playwright/comments.mjs",
  "tests/harness/document-flow/playwright/lock.mjs",
  "tests/harness/document-flow/playwright/i18n.mjs",
  "tests/harness/document-flow/playwright/ppt-context.mjs",
  "tests/harness/document-flow/playwright/_helpers/account.mjs",
];

test("document-flow playwright harness files exist", () => {
  for (const relativePath of files) {
    assert.equal(existsSync(path.join(repoRoot, relativePath)), true, `${relativePath} should exist`);
  }
});
