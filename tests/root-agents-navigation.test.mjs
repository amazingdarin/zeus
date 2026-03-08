import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();
const agents = readFileSync(path.join(repoRoot, "AGENTS.md"), "utf8");

test("AGENTS links to architecture and eval indexes", () => {
  assert.match(agents, /docs\/architecture\/README\.md/);
  assert.match(agents, /docs\/evals\/README\.md/);
});

test("architecture and eval index docs exist", () => {
  assert.equal(existsSync(path.join(repoRoot, "docs/architecture/README.md")), true);
  assert.equal(existsSync(path.join(repoRoot, "docs/evals/README.md")), true);
});
