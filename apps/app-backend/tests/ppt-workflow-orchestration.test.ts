import assert from "node:assert/strict";
import { after, test } from "node:test";

import { DEEP_SEARCH_CONTEXT_PLACEHOLDER, executeChatGraph } from "../src/services/chat-graph.ts";
import { projectSkillConfigStore } from "../src/llm/agent/project-skill-config-store.ts";
import { configStore } from "../src/llm/index.ts";
import { webSearchConfigStore } from "../src/services/web-search-config.ts";
import { closePool } from "../src/db/postgres.ts";

type EnabledSkillIdsFn = (
  projectKey: string,
  skills: Array<{ id: string }>,
) => Promise<string[]>;

function mockEnabledSkills(skillIds: string[]): () => void {
  const store = projectSkillConfigStore as unknown as { getEnabledSkillIds: EnabledSkillIdsFn };
  const original: EnabledSkillIdsFn = store.getEnabledSkillIds.bind(projectSkillConfigStore);
  store.getEnabledSkillIds = async () => skillIds;
  return () => {
    store.getEnabledSkillIds = original;
  };
}

function mockNoLLMConfig(): () => void {
  const store = configStore as unknown as {
    getInternalByType: (type: string) => Promise<unknown>;
  };
  const original = store.getInternalByType.bind(configStore);
  store.getInternalByType = async () => null;
  return () => {
    store.getInternalByType = original;
  };
}

function mockWebSearchEnabled(enabled: boolean): () => void {
  const store = webSearchConfigStore as unknown as {
    get: () => Promise<unknown>;
  };
  const original = store.get.bind(webSearchConfigStore);
  store.get = async () => (enabled
    ? {
      id: "mock-web-search",
      provider: "duckduckgo",
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    : null);
  return () => {
    store.get = original;
  };
}

after(async () => {
  await closePool();
});

test("ppt topic request orchestrates create -> outline -> html", async () => {
  const restore = mockEnabledSkills([
    "native:doc-create",
    "native:doc-optimize-ppt",
    "native:doc-optimize-ppt-outline",
    "native:doc-render-ppt-html",
    "native:doc-export-ppt",
  ]);
  const restoreConfig = mockNoLLMConfig();

  try {
    const runId = `test-run-ppt-topic-${Date.now()}`;
    const result = await executeChatGraph(runId, {
      userQuery: "帮我制作一个关于金融知识方面的PPT",
      messages: [{ role: "user", content: "帮我制作一个关于金融知识方面的PPT" }],
      projectKey: "smoke",
      userId: "user-1",
      sessionId: "session-1",
      fullAccess: true,
    });

    assert.equal(result.status, "complete");
    if (result.status !== "complete") return;

    assert.equal(result.plan.action, "execute_skill_batch");
    if (result.plan.action !== "execute_skill_batch") return;

    assert.equal(result.plan.tasks.length, 3);
    const task1 = result.plan.tasks[0]!;
    const task2 = result.plan.tasks[1]!;
    const task3 = result.plan.tasks[2]!;

    assert.equal(task1.skillId, "native:doc-create");
    assert.equal(task2.skillId, "native:doc-optimize-ppt-outline");
    assert.equal(task3.skillId, "native:doc-render-ppt-html");

    assert.equal(task2.failurePolicy, "required");
    assert.equal(task3.failurePolicy, "best_effort");

    assert.deepEqual(task2.dependsOn, [task1.taskId]);
    assert.deepEqual(task2.inputBindings, [{ fromTaskId: task1.taskId, fromKey: "docId", toArg: "doc_id" }]);

    assert.deepEqual(task3.dependsOn, [task2.taskId]);
    assert.deepEqual(task3.inputBindings, [{ fromTaskId: task2.taskId, fromKey: "docId", toArg: "doc_id" }]);
  } finally {
    restore();
    restoreConfig();
  }
});

test("ppt topic request with export orchestrates create -> outline -> html -> export", async () => {
  const restore = mockEnabledSkills([
    "native:doc-create",
    "native:doc-optimize-ppt",
    "native:doc-optimize-ppt-outline",
    "native:doc-render-ppt-html",
    "native:doc-export-ppt",
  ]);
  const restoreConfig = mockNoLLMConfig();

  try {
    const runId = `test-run-ppt-topic-export-${Date.now()}`;
    const result = await executeChatGraph(runId, {
      userQuery: "帮我制作一个关于金融知识方面的PPT，并导出为pptx",
      messages: [{ role: "user", content: "帮我制作一个关于金融知识方面的PPT，并导出为pptx" }],
      projectKey: "smoke",
      userId: "user-1",
      sessionId: "session-1",
      fullAccess: true,
    });

    assert.equal(result.status, "complete");
    if (result.status !== "complete") return;

    assert.equal(result.plan.action, "execute_skill_batch");
    if (result.plan.action !== "execute_skill_batch") return;

    assert.equal(result.plan.tasks.length, 4);
    const task1 = result.plan.tasks[0]!;
    const task2 = result.plan.tasks[1]!;
    const task3 = result.plan.tasks[2]!;
    const task4 = result.plan.tasks[3]!;

    assert.equal(task1.skillId, "native:doc-create");
    assert.equal(task2.skillId, "native:doc-optimize-ppt-outline");
    assert.equal(task3.skillId, "native:doc-render-ppt-html");
    assert.equal(task4.skillId, "native:doc-export-ppt");

    assert.equal(task3.failurePolicy, "best_effort");
    assert.equal(task4.failurePolicy, "required");

    assert.deepEqual(task2.dependsOn, [task1.taskId]);
    assert.deepEqual(task2.inputBindings, [{ fromTaskId: task1.taskId, fromKey: "docId", toArg: "doc_id" }]);

    assert.deepEqual(task3.dependsOn, [task2.taskId]);
    assert.deepEqual(task3.inputBindings, [{ fromTaskId: task2.taskId, fromKey: "docId", toArg: "doc_id" }]);

    assert.deepEqual(task4.dependsOn, [task2.taskId]);
    assert.deepEqual(task4.inputBindings, [{ fromTaskId: task2.taskId, fromKey: "docId", toArg: "doc_id" }]);
  } finally {
    restore();
    restoreConfig();
  }
});

test("scoped document PPT request skips creation and starts from outline", async () => {
  const restore = mockEnabledSkills([
    "native:doc-create",
    "native:doc-optimize-ppt",
    "native:doc-optimize-ppt-outline",
    "native:doc-render-ppt-html",
    "native:doc-export-ppt",
  ]);
  const restoreConfig = mockNoLLMConfig();

  try {
    const runId = `test-run-ppt-scoped-${Date.now()}`;
    const result = await executeChatGraph(runId, {
      userQuery: "@xxx 帮我做成PPT",
      messages: [{ role: "user", content: "@xxx 帮我做成PPT" }],
      projectKey: "smoke",
      userId: "user-1",
      sessionId: "session-1",
      docIds: ["doc-123"],
      fullAccess: true,
    });

    assert.equal(result.status, "complete");
    if (result.status !== "complete") return;

    assert.equal(result.plan.action, "execute_skill_batch");
    if (result.plan.action !== "execute_skill_batch") return;

    assert.equal(result.plan.tasks.length, 2);
    const task1 = result.plan.tasks[0]!;
    const task2 = result.plan.tasks[1]!;

    assert.equal(task1.skillId, "native:doc-optimize-ppt-outline");
    assert.deepEqual(task1.docIds, ["doc-123"]);

    assert.equal(task2.skillId, "native:doc-render-ppt-html");
    assert.deepEqual(task2.dependsOn, [task1.taskId]);
    assert.deepEqual(task2.inputBindings, [{ fromTaskId: task1.taskId, fromKey: "docId", toArg: "doc_id" }]);
  } finally {
    restore();
    restoreConfig();
  }
});

test("deep-search PPT topic request orchestrates deep search + create -> outline -> html", async () => {
  const restore = mockEnabledSkills([
    "native:doc-create",
    "native:doc-optimize-ppt",
    "native:doc-optimize-ppt-outline",
    "native:doc-render-ppt-html",
    "native:doc-export-ppt",
  ]);

  try {
    const runId = `test-run-deep-search-ppt-${Date.now()}`;
    const result = await executeChatGraph(runId, {
      userQuery: "查看今天的全球金融市场，并整理成PPT",
      messages: [{ role: "user", content: "查看今天的全球金融市场，并整理成PPT" }],
      projectKey: "smoke",
      userId: "user-1",
      sessionId: "session-1",
      deepSearchRequested: true,
      fullAccess: true,
    });

    assert.equal(result.status, "complete");
    if (result.status !== "complete") return;

    assert.equal(result.plan.action, "deep_search_then_skill_batch");
    if (result.plan.action !== "deep_search_then_skill_batch") return;

    assert.equal(result.plan.tasks.length, 3);
    const task1 = result.plan.tasks[0]!;
    const task2 = result.plan.tasks[1]!;
    const task3 = result.plan.tasks[2]!;

    assert.equal(task1.skillId, "native:doc-create");
    assert.equal(task1.args.description, DEEP_SEARCH_CONTEXT_PLACEHOLDER);
    assert.equal(task2.skillId, "native:doc-optimize-ppt-outline");
    assert.equal(task3.skillId, "native:doc-render-ppt-html");
    assert.deepEqual(task2.dependsOn, [task1.taskId]);
    assert.deepEqual(task2.inputBindings, [{ fromTaskId: task1.taskId, fromKey: "docId", toArg: "doc_id" }]);
  } finally {
    restore();
  }
});

test("deep-search non-ppt request remains deep_search", async () => {
  const runId = `test-run-deep-search-plain-${Date.now()}`;
  const result = await executeChatGraph(runId, {
    userQuery: "查看今天全球金融市场的主要变化",
    messages: [{ role: "user", content: "查看今天全球金融市场的主要变化" }],
    projectKey: "smoke",
    userId: "user-1",
    sessionId: "session-1",
    deepSearchRequested: true,
    fullAccess: true,
  });

  assert.equal(result.status, "complete");
  if (result.status !== "complete") return;

  assert.equal(result.plan.action, "deep_search");
});

test("web-search enabled forces web-search task in skill orchestration", async () => {
  const restoreSkills = mockEnabledSkills([
    "native:web-search",
    "native:doc-create",
  ]);
  const restoreWebSearch = mockWebSearchEnabled(true);

  try {
    const runId = `test-run-web-search-inject-${Date.now()}`;
    const result = await executeChatGraph(runId, {
      userQuery: "/doc-create 今日全球金融市场简报",
      messages: [{ role: "user", content: "/doc-create 今日全球金融市场简报" }],
      projectKey: "smoke",
      userId: "user-1",
      sessionId: "session-1",
      fullAccess: true,
    });

    assert.equal(result.status, "complete");
    if (result.status !== "complete") return;

    assert.equal(result.plan.action, "execute_skill_batch");
    if (result.plan.action !== "execute_skill_batch") return;

    assert.equal(result.plan.tasks.length, 2);
    assert.equal(result.plan.tasks[0]?.skillId, "native:web-search");
    assert.equal(result.plan.tasks[1]?.skillId, "native:doc-create");
  } finally {
    restoreWebSearch();
    restoreSkills();
  }
});

test("web-search enabled forces web-search task in deep-search ppt orchestration", async () => {
  const restoreSkills = mockEnabledSkills([
    "native:web-search",
    "native:doc-create",
    "native:doc-optimize-ppt",
    "native:doc-optimize-ppt-outline",
    "native:doc-render-ppt-html",
    "native:doc-export-ppt",
  ]);
  const restoreWebSearch = mockWebSearchEnabled(true);

  try {
    const runId = `test-run-web-search-deep-ppt-${Date.now()}`;
    const result = await executeChatGraph(runId, {
      userQuery: "查看今天的全球金融市场，并整理成PPT",
      messages: [{ role: "user", content: "查看今天的全球金融市场，并整理成PPT" }],
      projectKey: "smoke",
      userId: "user-1",
      sessionId: "session-1",
      deepSearchRequested: true,
      fullAccess: true,
    });

    assert.equal(result.status, "complete");
    if (result.status !== "complete") return;

    assert.equal(result.plan.action, "deep_search_then_skill_batch");
    if (result.plan.action !== "deep_search_then_skill_batch") return;

    assert.equal(result.plan.tasks[0]?.skillId, "native:web-search");
  } finally {
    restoreWebSearch();
    restoreSkills();
  }
});
