import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const fixturePath = path.join(repoRoot, "tests/fixtures/project-scope/personal.json");

test("project-scope personal fixture contract", () => {
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  for (const key of [
    "ownerType",
    "ownerKey",
    "projectKey",
    "alternateProjectKey",
    "invalidOwnerKey",
  ]) {
    assert.equal(typeof fixture[key], "string", `${key} must be a string`);
    assert.ok(String(fixture[key]).trim().length > 0, `${key} must not be empty`);
  }
});
