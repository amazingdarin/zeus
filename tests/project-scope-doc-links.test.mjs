import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();
const evalDoc = readFileSync(path.join(repoRoot, "docs/evals/project-scope.md"), "utf8");
const archDoc = readFileSync(path.join(repoRoot, "docs/architecture/project-scope.md"), "utf8");
const evalIndex = readFileSync(path.join(repoRoot, "docs/evals/README.md"), "utf8");

test("project-scope docs mention personal and team scope harnesses", () => {
  assert.match(evalDoc, /personal owner scope/i);
  assert.match(evalDoc, /team role matrix/i);
  assert.match(evalDoc, /eval:project-scope:personal/);
  assert.match(evalDoc, /eval:project-scope:team/);
  assert.match(evalDoc, /seed:project-scope/);
  assert.match(evalDoc, /personal-project-ref/i);
  assert.match(evalDoc, /team-project-ref/i);
  assert.match(archDoc, /frontend projectRef/i);
  assert.match(archDoc, /team role matrix/i);
  assert.match(evalIndex, /project-scope\.md/);
  assert.match(evalIndex, /team role matrix/i);
});
