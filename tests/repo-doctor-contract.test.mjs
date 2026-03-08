import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

test("repo-doctor prints required top-level checks", () => {
  const output = execFileSync("node", ["scripts/dev/repo-doctor.mjs", "--json"], {
    encoding: "utf8",
    cwd: process.cwd(),
  });
  const data = JSON.parse(output);
  for (const key of ["server", "appBackend", "web", "postgres", "testAccount", "documentFlow", "chat", "projectScope", "plugins"]) {
    assert.ok(key in data, `${key} must be present`);
  }
});
