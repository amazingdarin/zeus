import assert from "node:assert/strict";
import { after, test } from "node:test";

import { agentOrchestrator } from "../src/llm/agent/orchestrator.ts";
import { projectSkillConfigStore } from "../src/llm/agent/project-skill-config-store.ts";
import { agentSkillCatalog } from "../src/llm/agent/skill-catalog.ts";
import { detectSkillIntent } from "../src/llm/skills/executor.ts";
import { closePool } from "../src/db/postgres.ts";

type EnabledSkillIdsFn = (
  projectKey: string,
  skills: Array<{ id: string }>,
) => Promise<string[]>;

const OPTIMIZE_SKILL_IDS = [
  "native:doc-optimize-format",
  "native:doc-optimize-content",
  "native:doc-optimize-style",
  "native:doc-optimize-full",
];

after(async () => {
  await closePool();
});

test("detectSkillIntent parses optimize commands and style args", () => {
  const styleIntent = detectSkillIntent("/doc-optimize-style academic 保持术语统一", ["doc-1"]);
  assert(styleIntent);
  assert.equal(styleIntent.skill, "doc-optimize-style");
  assert.deepEqual(styleIntent.args, {
    style: "academic",
    instructions: "保持术语统一",
  });

  const formatIntent = detectSkillIntent("/doc-optimize-format 增加标题层级", ["doc-1"]);
  assert(formatIntent);
  assert.equal(formatIntent.skill, "doc-optimize-format");
  assert.deepEqual(formatIntent.args, {
    instructions: "增加标题层级",
  });

  const fullIntent = detectSkillIntent("/doc-optimize-full", ["doc-1"]);
  assert(fullIntent);
  assert.equal(fullIntent.skill, "doc-optimize-full");
  assert.deepEqual(fullIntent.args, {});
});

test("agentSkillCatalog exposes 4 optimize native skills with expected contract", async () => {
  await agentSkillCatalog.initialize();
  const skills = agentSkillCatalog.getAllSkills();
  const optimizeSkills = skills.filter((s) => OPTIMIZE_SKILL_IDS.includes(s.id));

  assert.equal(optimizeSkills.length, 4);
  for (const skill of optimizeSkills) {
    assert.equal(skill.source, "native");
    assert.equal(skill.risk.level, "medium");
    assert.equal(skill.risk.requireConfirmation, true);
    assert.equal(typeof skill.command, "string");
    assert.equal(skill.inputSchema.required.includes("doc_id"), true);
    assert.equal(skill.metadata?.requiresDocScope, true);
  }

  const styleSkill = optimizeSkills.find((s) => s.id === "native:doc-optimize-style");
  assert(styleSkill);
  assert.equal(styleSkill.inputSchema.required.includes("style"), true);
  const styleEnum = styleSkill.inputSchema.properties.style?.enum || [];
  assert.equal(styleEnum.includes("professional"), true);
  assert.equal(styleEnum.includes("technical"), true);
});

test("AgentOrchestrator blocks explicit optimize command when disabled", async () => {
  const store = projectSkillConfigStore as unknown as { getEnabledSkillIds: EnabledSkillIdsFn };
  const original: EnabledSkillIdsFn = store.getEnabledSkillIds.bind(projectSkillConfigStore);

  store.getEnabledSkillIds = async () => [];
  try {
    const plan = await agentOrchestrator.plan({
      projectKey: "smoke",
      userMessage: "/doc-optimize-format 请优化",
      messages: [{ role: "user", content: "/doc-optimize-format 请优化" }],
      docIds: ["doc-1"],
      llmConfig: null,
    });

    assert.equal(plan.mode, "blocked");
    if (plan.mode === "blocked") {
      assert.equal(plan.command, "/doc-optimize-format");
    }
  } finally {
    store.getEnabledSkillIds = original;
  }
});

test("AgentOrchestrator executes style optimize command with parsed args when enabled", async () => {
  const store = projectSkillConfigStore as unknown as { getEnabledSkillIds: EnabledSkillIdsFn };
  const original: EnabledSkillIdsFn = store.getEnabledSkillIds.bind(projectSkillConfigStore);

  store.getEnabledSkillIds = async () => ["native:doc-optimize-style"];
  try {
    const plan = await agentOrchestrator.plan({
      projectKey: "smoke",
      userMessage: "/doc-optimize-style concise 保留原始技术术语",
      messages: [{ role: "user", content: "/doc-optimize-style concise 保留原始技术术语" }],
      docIds: ["doc-1"],
      llmConfig: null,
    });

    assert.equal(plan.mode, "execute");
    if (plan.mode === "execute") {
      assert.equal(plan.skill.id, "native:doc-optimize-style");
      assert.deepEqual(plan.args, {
        style: "concise",
        instructions: "保留原始技术术语",
      });
      assert.deepEqual(plan.docIds, ["doc-1"]);
      assert.equal(plan.sourceIntent, "command");
    }
  } finally {
    store.getEnabledSkillIds = original;
  }
});
