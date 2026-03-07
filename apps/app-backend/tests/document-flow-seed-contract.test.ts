import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const fixtureRoot = path.join(repoRoot, "tests/fixtures/document-flow");
const documentsDir = path.join(fixtureRoot, "documents");

test("document-flow seed fixtures define project and document coverage", () => {
  const projectFixture = JSON.parse(readFileSync(path.join(fixtureRoot, "project.json"), "utf8"));
  assert.equal(typeof projectFixture.projectKey, "string");
  assert.equal(typeof projectFixture.emptyProjectKey, "string");

  const documentFiles = readdirSync(documentsDir).filter((name) => name.endsWith(".json"));
  assert.ok(documentFiles.length >= 3, "expected at least three document fixtures");
  assert.ok(documentFiles.includes("locked.json"), "expected locked document fixture");
  assert.ok(documentFiles.includes("commented.json"), "expected commented document fixture");

  const commentFixture = JSON.parse(readFileSync(path.join(fixtureRoot, "comment-thread.json"), "utf8"));
  assert.equal(typeof commentFixture.blockId, "string");
  assert.equal(typeof commentFixture.content, "string");
});
