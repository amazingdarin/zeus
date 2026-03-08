import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const makefile = readFileSync(path.join(repoRoot, "Makefile"), "utf8");

test("project-scope seed contract is wired", () => {
  assert.equal(existsSync(path.join(repoRoot, "scripts/dev/project-scope-seed.mjs")), true, "seed script should exist");
  assert.equal(existsSync(path.join(repoRoot, "tests/harness/project-scope/api/_helpers/team-context.mjs")), true, "team context helper should exist");
  assert.equal(packageJson.scripts?.["seed:project-scope"], "node scripts/dev/project-scope-seed.mjs", "package.json should expose seed:project-scope");
  assert.match(makefile, /^project-scope-seed:\n\tnpm run seed:project-scope$/m, "Makefile should expose project-scope-seed");
});
