import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();
const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const makefile = readFileSync(path.join(repoRoot, "Makefile"), "utf8");

for (const scriptName of [
  "doctor:doc-flow",
  "seed:doc-flow",
  "reset:doc-flow",
  "eval:doc-flow:smoke",
  "eval:doc-flow:api",
]) {
  test(`package.json includes ${scriptName}`, () => {
    assert.equal(typeof pkg.scripts?.[scriptName], "string");
  });
}

for (const target of ["doc-flow-doctor:", "doc-flow-seed:", "doc-flow-eval:"]) {
  test(`Makefile includes ${target}`, () => {
    assert.match(makefile, new RegExp(`^${target}`, "m"));
  });
}
