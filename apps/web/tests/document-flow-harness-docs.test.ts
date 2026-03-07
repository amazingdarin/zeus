import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const files = [
  "tests/harness/document-flow/README.md",
  "tests/fixtures/document-flow/README.md",
  "docs/architecture/document-flow.md",
  "docs/evals/document-flow.md",
];

test("document-flow harness docs exist", () => {
  for (const relativePath of files) {
    const text = readFileSync(path.join(repoRoot, relativePath), "utf8");
    assert.match(text.toLowerCase(), /document flow|seed|regression/);
  }
});
