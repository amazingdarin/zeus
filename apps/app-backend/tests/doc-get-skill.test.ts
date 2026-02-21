import assert from "node:assert/strict";
import { test } from "node:test";

import {
  documentSkills,
  getDocumentSkill,
  getDocumentSkillByCommand,
} from "../src/llm/skills/document-skills.ts";

test("documentSkills exposes doc-get", () => {
  const byName = getDocumentSkill("doc-get");
  const byCommand = getDocumentSkillByCommand("/doc-get");
  const inList = documentSkills.some((skill) => skill.name === "doc-get");

  assert.equal(inList, true);
  assert(byName, "doc-get skill should exist");
  assert(byCommand, "/doc-get command should resolve to a skill");
  assert.equal(byName?.command, "/doc-get");
});

test("doc-get input schema supports meta-only and content modes", () => {
  const skill = getDocumentSkill("doc-get");
  assert(skill, "doc-get skill should exist");

  const metaOnly = skill!.inputSchema.safeParse({ doc_id: "doc-1" });
  const withContent = skill!.inputSchema.safeParse({
    doc_id: "doc-1",
    include_content: true,
    include_block_attrs: true,
    block_types: ["file_block", "paragraph"],
  });

  assert.equal(metaOnly.success, true);
  assert.equal(withContent.success, true);
});
