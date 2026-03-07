import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { after, test } from "node:test";

import {
  executeChatGraph,
  resumeChatGraphWithPreflightInput,
} from "../src/services/chat-graph.ts";
import { projectSkillConfigStore } from "../src/llm/agent/project-skill-config-store.ts";
import { closePool } from "../src/db/postgres.ts";
import { documentStore } from "../src/storage/document-store.ts";
import { getScopedDocsRoot } from "../src/storage/paths.ts";

type EnabledSkillIdsFn = (
  projectKey: string,
  skills: Array<{ id: string }>,
) => Promise<string[]>;

after(async () => {
  await closePool();
});

async function withMediaTranscribeOnlyEnabled(
  run: () => Promise<void>,
): Promise<void> {
  const store = projectSkillConfigStore as unknown as { getEnabledSkillIds: EnabledSkillIdsFn };
  const original: EnabledSkillIdsFn = store.getEnabledSkillIds.bind(projectSkillConfigStore);
  store.getEnabledSkillIds = async () => ["native:media-transcribe"];
  try {
    await run();
  } finally {
    store.getEnabledSkillIds = original;
  }
}

function makeVideoBlock(blockId: string, assetId: string, filename: string) {
  return {
    type: "file_block",
    attrs: {
      id: blockId,
      asset_id: assetId,
      file_name: filename,
      mime: "video/mp4",
    },
  };
}

async function seedDocWithVideoBlocks(input: {
  userId: string;
  projectKey: string;
  docId: string;
  title: string;
  blocks: Array<{ blockId: string; assetId: string; filename: string }>;
}): Promise<void> {
  const now = new Date().toISOString();
  await documentStore.save(input.userId, input.projectKey, {
    meta: {
      id: input.docId,
      schema_version: "v1",
      title: input.title,
      slug: input.docId,
      path: "",
      parent_id: "root",
      created_at: now,
      updated_at: now,
    },
    body: {
      type: "tiptap",
      content: {
        type: "doc",
        content: input.blocks.map((item) => (
          makeVideoBlock(item.blockId, item.assetId, item.filename)
        )),
      },
    },
  });
}

async function cleanupProjectDocs(userId: string, projectKey: string): Promise<void> {
  await rm(getScopedDocsRoot(userId, projectKey), { recursive: true, force: true });
}

test("media-transcribe batch command is decomposed into per-asset orchestrated tasks", async () => {
  await withMediaTranscribeOnlyEnabled(async () => {
    const runId = `test-run-media-transcribe-batch-${Date.now()}`;
    const result = await executeChatGraph(runId, {
      userQuery: "/media-transcribe 全部转写",
      messages: [{ role: "user", content: "/media-transcribe 全部转写" }],
      projectKey: "smoke",
      userId: "user-1",
      sessionId: "session-1",
      attachments: [
        {
          assetId: "asset-a",
          name: "meeting-a.mp3",
          mimeType: "audio/mpeg",
          type: "file",
        },
        {
          assetId: "asset-b",
          name: "meeting-b.mp4",
          mimeType: "video/mp4",
          type: "file",
        },
      ],
      fullAccess: true,
    });

    assert.equal(result.status, "complete");
    if (result.status !== "complete") return;

    assert.equal(result.plan.action, "execute_skill_batch");
    if (result.plan.action !== "execute_skill_batch") return;

    assert.equal(result.plan.tasks.length, 2);
    const [first, second] = result.plan.tasks;
    assert(first);
    assert(second);

    assert.equal(first.skillId, "native:media-transcribe");
    assert.equal(second.skillId, "native:media-transcribe");

    assert.equal(first.args.asset_id, "asset-a");
    assert.equal(second.args.asset_id, "asset-b");
    assert.equal("asset_ids" in first.args, false);
    assert.equal("asset_ids" in second.args, false);

    assert.equal(first.title.includes("(1/2)"), true);
    assert.equal(second.title.includes("(2/2)"), true);
  });
});

test("media-transcribe handles a single uploaded video without extra confirmation input", async () => {
  await withMediaTranscribeOnlyEnabled(async () => {
    const runId = `test-run-media-transcribe-single-upload-${Date.now()}`;
    const result = await executeChatGraph(runId, {
      userQuery: "/media-transcribe",
      messages: [{ role: "user", content: "/media-transcribe" }],
      projectKey: "smoke",
      userId: "user-1",
      sessionId: "session-1",
      attachments: [{
        assetId: "asset-video-single",
        name: "intro.mp4",
        mimeType: "video/mp4",
        type: "file",
      }],
      fullAccess: true,
    });

    assert.equal(result.status, "complete");
    if (result.status !== "complete") return;
    assert.equal(result.plan.action, "execute_skill");
    if (result.plan.action !== "execute_skill") return;
    assert.equal(result.plan.skillId, "native:media-transcribe");
    assert.equal(result.plan.args.asset_id, "asset-video-single");
    assert.equal("asset_ids" in result.plan.args, false);
  });
});

test("media-transcribe for one scoped doc with one video auto-selects and executes", async () => {
  const userId = "user-doc-single";
  const projectKey = `proj-doc-single-${Date.now()}`;
  const docId = `doc-single-${Date.now()}`;
  try {
    await seedDocWithVideoBlocks({
      userId,
      projectKey,
      docId,
      title: "Doc Single Video",
      blocks: [{
        blockId: "block-1",
        assetId: "asset-doc-single-video",
        filename: "doc-single.mp4",
      }],
    });

    await withMediaTranscribeOnlyEnabled(async () => {
      const runId = `test-run-doc-single-video-${Date.now()}`;
      const result = await executeChatGraph(runId, {
        userQuery: "/media-transcribe",
        messages: [{ role: "user", content: "/media-transcribe" }],
        projectKey,
        userId,
        sessionId: "session-1",
        docIds: [docId],
        fullAccess: true,
      });

      assert.equal(result.status, "complete");
      if (result.status !== "complete") return;
      assert.equal(result.plan.action, "execute_skill");
      if (result.plan.action !== "execute_skill") return;
      assert.equal(result.plan.args.asset_id, "asset-doc-single-video");
    });
  } finally {
    await cleanupProjectDocs(userId, projectKey);
  }
});

test("media-transcribe for one scoped doc with multiple videos requires candidate confirmation", async () => {
  const userId = "user-doc-multi";
  const projectKey = `proj-doc-multi-${Date.now()}`;
  const docId = `doc-multi-${Date.now()}`;
  try {
    await seedDocWithVideoBlocks({
      userId,
      projectKey,
      docId,
      title: "Doc Multi Video",
      blocks: [
        {
          blockId: "block-a",
          assetId: "asset-doc-multi-a",
          filename: "doc-a.mp4",
        },
        {
          blockId: "block-b",
          assetId: "asset-doc-multi-b",
          filename: "doc-b.mp4",
        },
      ],
    });

    await withMediaTranscribeOnlyEnabled(async () => {
      const runId = `test-run-doc-multi-video-${Date.now()}`;
      const first = await executeChatGraph(runId, {
        userQuery: "/media-transcribe",
        messages: [{ role: "user", content: "/media-transcribe" }],
        projectKey,
        userId,
        sessionId: "session-1",
        docIds: [docId],
        fullAccess: true,
      });

      assert.equal(first.status, "awaiting_preflight_input");
      if (first.status !== "awaiting_preflight_input") return;

      const missing = first.pendingPreflight.missingInputs[0];
      assert(missing);
      assert.equal(missing.kind, "skill_args");
      assert.equal(missing.skillName, "media-transcribe");
      assert.equal(missing.missing?.includes("candidate_key"), true);

      const candidateField = (missing.fields || []).find((field) => field.key === "candidate_key");
      assert(candidateField);
      assert.equal(candidateField?.widget, "choice_list");
      assert.equal((candidateField?.options || []).length, 2);

      const selectedCandidate = candidateField?.options?.[0]?.value || "";
      assert.equal(selectedCandidate.length > 0, true);

      const resumed = await resumeChatGraphWithPreflightInput(runId, {
        taskInputs: [{
          taskId: missing.taskId,
          args: { candidate_key: selectedCandidate },
        }],
      });

      assert.equal(resumed.status, "complete");
      if (resumed.status !== "complete") return;
      assert.equal(resumed.plan.action, "execute_skill");
      if (resumed.plan.action !== "execute_skill") return;
      assert.equal(resumed.plan.skillId, "native:media-transcribe");

      const expectedAssetId = selectedCandidate.split(":").at(-1) || "";
      assert.equal(resumed.plan.args.asset_id, expectedAssetId);
    });
  } finally {
    await cleanupProjectDocs(userId, projectKey);
  }
});

test("media-transcribe across multiple scoped docs requires target_mode and candidate confirmation", async () => {
  const userId = "user-multi-docs";
  const projectKey = `proj-multi-docs-${Date.now()}`;
  const docIdA = `doc-a-${Date.now()}`;
  const docIdB = `doc-b-${Date.now()}`;
  try {
    await seedDocWithVideoBlocks({
      userId,
      projectKey,
      docId: docIdA,
      title: "Doc A",
      blocks: [{
        blockId: "block-a",
        assetId: "asset-multi-doc-a",
        filename: "multi-a.mp4",
      }],
    });
    await seedDocWithVideoBlocks({
      userId,
      projectKey,
      docId: docIdB,
      title: "Doc B",
      blocks: [{
        blockId: "block-b",
        assetId: "asset-multi-doc-b",
        filename: "multi-b.mp4",
      }],
    });

    await withMediaTranscribeOnlyEnabled(async () => {
      const runId = `test-run-multi-doc-video-${Date.now()}`;
      const first = await executeChatGraph(runId, {
        userQuery: "/media-transcribe",
        messages: [{ role: "user", content: "/media-transcribe" }],
        projectKey,
        userId,
        sessionId: "session-1",
        docIds: [docIdA, docIdB],
        fullAccess: true,
      });

      assert.equal(first.status, "awaiting_preflight_input");
      if (first.status !== "awaiting_preflight_input") return;

      const modeMissing = first.pendingPreflight.missingInputs[0];
      assert(modeMissing);
      assert.equal(modeMissing.kind, "skill_args");
      assert.equal(modeMissing.missing?.includes("target_mode"), true);

      const resumedTargetMode = await resumeChatGraphWithPreflightInput(runId, {
        taskInputs: [{
          taskId: modeMissing.taskId,
          args: { target_mode: "single" },
        }],
      });

      assert.equal(resumedTargetMode.status, "awaiting_preflight_input");
      if (resumedTargetMode.status !== "awaiting_preflight_input") return;

      const candidateMissing = resumedTargetMode.pendingPreflight.missingInputs[0];
      assert(candidateMissing);
      assert.equal(candidateMissing.kind, "skill_args");
      assert.equal(candidateMissing.missing?.includes("candidate_key"), true);

      const candidateField = (candidateMissing.fields || []).find((field) => field.key === "candidate_key");
      assert(candidateField);
      assert.equal(candidateField?.widget, "choice_list");
      assert.equal((candidateField?.options || []).length >= 2, true);
      const selectedCandidate = candidateField?.options?.[0]?.value || "";
      assert.equal(selectedCandidate.length > 0, true);

      const resumedCandidate = await resumeChatGraphWithPreflightInput(runId, {
        taskInputs: [{
          taskId: candidateMissing.taskId,
          args: { candidate_key: selectedCandidate },
        }],
      });

      assert.equal(resumedCandidate.status, "complete");
      if (resumedCandidate.status !== "complete") return;
      assert.equal(resumedCandidate.plan.action, "execute_skill");
      if (resumedCandidate.plan.action !== "execute_skill") return;
      assert.equal(resumedCandidate.plan.skillId, "native:media-transcribe");

      const expectedAssetId = selectedCandidate.split(":").at(-1) || "";
      assert.equal(resumedCandidate.plan.args.asset_id, expectedAssetId);
    });
  } finally {
    await cleanupProjectDocs(userId, projectKey);
  }
});
