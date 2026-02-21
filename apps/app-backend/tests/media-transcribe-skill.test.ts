import assert from "node:assert/strict";
import { test } from "node:test";

import {
  documentSkills,
  getDocumentSkill,
  getDocumentSkillByCommand,
} from "../src/llm/skills/document-skills.ts";

test("documentSkills exposes media-transcribe", () => {
  const byName = getDocumentSkill("media-transcribe");
  const byCommand = getDocumentSkillByCommand("/media-transcribe");
  const inList = documentSkills.some((skill) => skill.name === "media-transcribe");

  assert.equal(inList, true);
  assert(byName, "media-transcribe skill should exist");
  assert(byCommand, "/media-transcribe command should resolve to a skill");
  assert.equal(byName?.command, "/media-transcribe");
  assert.equal(byCommand?.name, "media-transcribe");
});

test("media-transcribe input schema validates required and optional args", () => {
  const skill = getDocumentSkill("media-transcribe");
  assert(skill, "media-transcribe skill should exist");

  const singleAssetOk = skill!.inputSchema.safeParse({ asset_id: "asset-123" });
  const multiAssetOk = skill!.inputSchema.safeParse({ asset_ids: ["asset-123", "asset-456"] });
  const candidateOk = skill!.inputSchema.safeParse({ candidate_key: "doc:doc-1:block-1:asset-1" });
  const candidateBatchOk = skill!.inputSchema.safeParse({
    candidate_keys: ["doc:doc-1:block-1:asset-1", "doc:doc-1:block-2:asset-2"],
    target_mode: "all",
  });
  const docBlockOk = skill!.inputSchema.safeParse({ doc_id: "doc-1", block_id: "block-1" });
  const optionalOk = skill!.inputSchema.safeParse({
    asset_id: "asset-123",
    media_scope: "video",
    language: "zh",
    prompt: "包含人名与术语",
    model: "whisper-1",
  });
  const missingRequired = skill!.inputSchema.safeParse({});

  assert.equal(singleAssetOk.success, true);
  assert.equal(multiAssetOk.success, true);
  assert.equal(candidateOk.success, true);
  assert.equal(candidateBatchOk.success, true);
  assert.equal(docBlockOk.success, true);
  assert.equal(optionalOk.success, true);
  assert.equal(missingRequired.success, false);
});
