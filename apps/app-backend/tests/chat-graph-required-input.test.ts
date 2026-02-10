import assert from "node:assert/strict";
import { after, test } from "node:test";

import {
  executeChatGraph,
  resumeChatGraphWithRequiredInput,
} from "../src/services/chat-graph.ts";
import { projectSkillConfigStore } from "../src/llm/agent/project-skill-config-store.ts";
import { closePool } from "../src/db/postgres.ts";

type EnabledSkillIdsFn = (
  projectKey: string,
  skills: Array<{ id: string }>,
) => Promise<string[]>;

after(async () => {
  await closePool();
});

test("chat-graph interrupts for missing required skill args (skill_args)", async () => {
  const store = projectSkillConfigStore as unknown as { getEnabledSkillIds: EnabledSkillIdsFn };
  const original: EnabledSkillIdsFn = store.getEnabledSkillIds.bind(projectSkillConfigStore);

  store.getEnabledSkillIds = async () => ["native:doc-import-git"];
  try {
    const runId = `test-run-skill-args-${Date.now()}`;
    const result = await executeChatGraph(runId, {
      userQuery: "/doc-import-git",
      messages: [{ role: "user", content: "/doc-import-git" }],
      projectKey: "smoke",
      userId: "user-1",
      sessionId: "session-1",
    });

    assert.equal(result.status, "awaiting_input");
    if (result.status !== "awaiting_input") return;

    assert.equal(result.pendingInput.kind, "skill_args");
    assert.equal(result.pendingInput.skillName, "doc-import-git");
    assert.deepEqual(result.pendingInput.missing, ["repo_url"]);
    assert.equal(
      result.pendingInput.fields.some((f) => f.key === "repo_url"),
      true,
    );

    const resumed = await resumeChatGraphWithRequiredInput(runId, {
      args: { repo_url: "https://example.com/repo.git" },
    });
    assert.equal(resumed.status, "awaiting_confirmation");
  } finally {
    store.getEnabledSkillIds = original;
  }
});

