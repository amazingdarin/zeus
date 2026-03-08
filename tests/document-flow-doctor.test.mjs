import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

test("document-flow doctor prints required checks", () => {
  const output = execFileSync("node", ["scripts/dev/document-flow-doctor.mjs", "--json"], {
    encoding: "utf8",
    cwd: new URL("..", import.meta.url),
  });
  const data = JSON.parse(output);
  for (const key of ["server", "appBackend", "web", "postgres", "testAccount"]) {
    assert.ok(key in data);
  }
});
