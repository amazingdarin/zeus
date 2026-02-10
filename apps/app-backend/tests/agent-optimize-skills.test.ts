import assert from "node:assert/strict";
import { after, test } from "node:test";

import { executeChatGraph, resumeChatGraph } from "../src/services/chat-graph.ts";
import { projectSkillConfigStore } from "../src/llm/agent/project-skill-config-store.ts";
import { agentSkillCatalog } from "../src/llm/agent/skill-catalog.ts";
import { closePool } from "../src/db/postgres.ts";
import { zodObjectToOpenAIParameters } from "../src/llm/zod.ts";
import { inferPlannerDomainFromAttachmentsAndText } from "../src/services/agents/planner-agent.ts";

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

test("agentSkillCatalog exposes 4 optimize native skills with expected contract", async () => {
  await agentSkillCatalog.initialize();
  const skills = agentSkillCatalog.getAllSkills();
  const optimizeSkills = skills.filter((s) => OPTIMIZE_SKILL_IDS.includes(s.id));

  assert.equal(optimizeSkills.length, 4);
  for (const skill of optimizeSkills) {
    const parameters = zodObjectToOpenAIParameters(skill.inputSchema);
    assert.equal(skill.source, "native");
    assert.equal(skill.risk.level, "medium");
    assert.equal(skill.risk.requireConfirmation, true);
    assert.equal(typeof skill.command, "string");
    assert.equal(parameters.required.includes("doc_id"), true);
    assert.equal(skill.metadata?.requiresDocScope, true);
  }

  const styleSkill = optimizeSkills.find((s) => s.id === "native:doc-optimize-style");
  assert(styleSkill);
  const styleParameters = zodObjectToOpenAIParameters(styleSkill.inputSchema);
  assert.equal(styleParameters.required.includes("style"), true);
  const styleEnum = styleParameters.properties.style?.enum || [];
  assert.equal(styleEnum.includes("professional"), true);
  assert.equal(styleEnum.includes("technical"), true);
});

test("chat-graph blocks explicit optimize command when disabled", async () => {
  const store = projectSkillConfigStore as unknown as { getEnabledSkillIds: EnabledSkillIdsFn };
  const original: EnabledSkillIdsFn = store.getEnabledSkillIds.bind(projectSkillConfigStore);

  store.getEnabledSkillIds = async () => [];
  try {
    const runId = `test-run-optimize-disabled-${Date.now()}`;
    const result = await executeChatGraph(runId, {
      projectKey: "smoke",
      userQuery: "/doc-optimize-format 请优化",
      messages: [{ role: "user", content: "/doc-optimize-format 请优化" }],
      userId: "user-1",
      sessionId: "session-1",
      docIds: ["doc-1"],
    });

    assert.equal(result.status, "complete");
    if (result.status !== "complete") return;
    assert.equal(result.plan.action, "respond_blocked");
    if (result.plan.action === "respond_blocked") {
      assert.equal(result.plan.reason.includes("/doc-optimize-format"), true);
    }
  } finally {
    store.getEnabledSkillIds = original;
  }
});

test("chat-graph resolves optimize style command and requests confirmation when enabled", async () => {
  const store = projectSkillConfigStore as unknown as { getEnabledSkillIds: EnabledSkillIdsFn };
  const original: EnabledSkillIdsFn = store.getEnabledSkillIds.bind(projectSkillConfigStore);

  store.getEnabledSkillIds = async () => ["native:doc-optimize-style"];
  try {
    const runId = `test-run-optimize-style-${Date.now()}`;
    const result = await executeChatGraph(runId, {
      projectKey: "smoke",
      userQuery: "/doc-optimize-style concise 保留原始技术术语",
      messages: [{ role: "user", content: "/doc-optimize-style concise 保留原始技术术语" }],
      userId: "user-1",
      sessionId: "session-1",
      docIds: ["doc-1"],
    });

    assert.equal(result.status, "awaiting_confirmation");
    if (result.status !== "awaiting_confirmation") return;

    assert.equal(result.pendingTool.skillName, "doc-optimize-style");
    assert.deepEqual(result.pendingTool.args, {
      doc_id: "doc-1",
      style: "concise",
      instructions: "保留原始技术术语",
    });

    const resumed = await resumeChatGraph(runId, true);
    assert.equal(resumed.status, "complete");
    if (resumed.status !== "complete") return;
    assert.equal(resumed.plan.action, "execute_skill");
    if (resumed.plan.action === "execute_skill") {
      assert.equal(resumed.plan.skillId, "native:doc-optimize-style");
      assert.deepEqual(resumed.plan.args, {
        doc_id: "doc-1",
        style: "concise",
        instructions: "保留原始技术术语",
      });
      assert.deepEqual(resumed.plan.docIds, ["doc-1"]);
      assert.equal(resumed.plan.sourceIntent, "command");
    }
  } finally {
    store.getEnabledSkillIds = original;
  }
});

test("planner select_domain routes image attachments to doc when import intent is explicit", () => {
  const domain = inferPlannerDomainFromAttachmentsAndText({
    userQuery: "请把这张图片导入成文档",
    attachments: [{ assetId: "asset-1", mimeType: "image/png", type: "image" }],
  });
  assert.equal(domain, "doc");
});

test("planner select_domain routes image attachments to img when OCR intent is explicit", () => {
  const domain = inferPlannerDomainFromAttachmentsAndText({
    userQuery: "OCR 这张图",
    attachments: [{ assetId: "asset-1", mimeType: "image/png", type: "image" }],
  });
  assert.equal(domain, "img");
});

test("planner select_domain lets code intent win even with image attachments", () => {
  const domain = inferPlannerDomainFromAttachmentsAndText({
    userQuery: "这个截图报错怎么解决？",
    attachments: [{ assetId: "asset-1", mimeType: "image/png", type: "image" }],
  });
  assert.equal(domain, "code");
});

test("planner select_domain routes non-image attachments to doc even if message mentions search", () => {
  const domain = inferPlannerDomainFromAttachmentsAndText({
    userQuery: "搜索一下这个文件里有没有提到 Zeus",
    attachments: [{ assetId: "asset-2", mimeType: "application/pdf", type: "file" }],
  });
  assert.equal(domain, "doc");
});
