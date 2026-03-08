import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const personalFixturePath = path.join(repoRoot, "tests/fixtures/project-scope/personal.json");
const teamFixturePath = path.join(repoRoot, "tests/fixtures/project-scope/team.json");

test("project-scope personal fixture contract", () => {
  const fixture = JSON.parse(readFileSync(personalFixturePath, "utf8"));
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

test("project-scope team fixture contract", () => {
  const fixture = JSON.parse(readFileSync(teamFixturePath, "utf8"));
  for (const key of ["ownerType", "ownerKey", "projectKey", "writeProbeDocId"]) {
    assert.equal(typeof fixture[key], "string", `${key} must be a string`);
    assert.ok(String(fixture[key]).trim().length > 0, `${key} must not be empty`);
  }
  for (const role of ["owner", "admin", "member", "viewer", "outsider"]) {
    assert.equal(typeof fixture.roles?.[role]?.accountKey, "string", `${role}.accountKey must be a string`);
    assert.ok(String(fixture.roles?.[role]?.accountKey ?? "").trim().length > 0, `${role}.accountKey must not be empty`);
  }
});
