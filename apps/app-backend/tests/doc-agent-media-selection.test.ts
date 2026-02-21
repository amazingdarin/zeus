import assert from "node:assert/strict";
import { after, test } from "node:test";

import { runDocAgent } from "../src/services/agents/doc-agent.ts";
import { closePool } from "../src/db/postgres.ts";

after(async () => {
  await closePool();
});

function buildCandidate(input: {
  candidateKey: string;
  assetId: string;
  label: string;
  docId?: string;
  docTitle?: string;
}): Record<string, unknown> {
  return {
    candidate_key: input.candidateKey,
    asset_id: input.assetId,
    source: "document",
    media_kind: "video",
    label: input.label,
    ...(input.docId ? { doc_id: input.docId } : {}),
    ...(input.docTitle ? { doc_title: input.docTitle } : {}),
  };
}

test("doc-agent asks candidate_key for single-doc multi media candidates", async () => {
  const result = await runDocAgent({
    userId: "user-1",
    matchedSkillId: "native:media-transcribe",
    skillArgs: {
      __media_candidates: [
        buildCandidate({
          candidateKey: "doc:doc-1:block-a:asset-a",
          assetId: "asset-a",
          label: "video-a.mp4 | Doc 1 | block:block-a",
          docId: "doc-1",
          docTitle: "Doc 1",
        }),
        buildCandidate({
          candidateKey: "doc:doc-1:block-b:asset-b",
          assetId: "asset-b",
          label: "video-b.mp4 | Doc 1 | block:block-b",
          docId: "doc-1",
          docTitle: "Doc 1",
        }),
      ],
    },
    skillDocIds: ["doc-1"],
    sourceIntent: "command",
    fullAccess: true,
  });

  assert(result.requiredInput);
  assert.equal(result.requiredInput?.kind, "skill_args");
  if (!result.requiredInput || result.requiredInput.kind !== "skill_args") return;

  assert.equal(result.requiredInput.missing?.includes("candidate_key"), true);
  const field = result.requiredInput.fields.find((item) => item.key === "candidate_key");
  assert(field);
  assert.equal(field?.widget, "choice_list");
  assert.equal(Array.isArray(field?.options), true);
  assert.equal(field?.options?.length, 2);
});

test("doc-agent asks target_mode first when candidates come from multiple docs", async () => {
  const result = await runDocAgent({
    userId: "user-1",
    matchedSkillId: "native:media-transcribe",
    skillArgs: {
      __media_candidates: [
        buildCandidate({
          candidateKey: "doc:doc-1:block-a:asset-a",
          assetId: "asset-a",
          label: "video-a.mp4 | Doc 1 | block:block-a",
          docId: "doc-1",
          docTitle: "Doc 1",
        }),
        buildCandidate({
          candidateKey: "doc:doc-2:block-x:asset-x",
          assetId: "asset-x",
          label: "video-x.mp4 | Doc 2 | block:block-x",
          docId: "doc-2",
          docTitle: "Doc 2",
        }),
      ],
    },
    skillDocIds: ["doc-1", "doc-2"],
    sourceIntent: "keyword",
    fullAccess: true,
  });

  assert(result.requiredInput);
  assert.equal(result.requiredInput?.kind, "skill_args");
  if (!result.requiredInput || result.requiredInput.kind !== "skill_args") return;

  assert.equal(result.requiredInput.missing?.includes("target_mode"), true);
  const field = result.requiredInput.fields.find((item) => item.key === "target_mode");
  assert(field);
  assert.equal(field?.widget, "choice_list");
  assert.deepEqual(field?.enum, ["single", "all"]);
});

test("doc-agent maps candidate_key and target_mode to executable args", async () => {
  const singleResult = await runDocAgent({
    userId: "user-1",
    matchedSkillId: "native:media-transcribe",
    skillArgs: {
      candidate_key: "doc:doc-1:block-a:asset-a",
      __media_candidates: [
        buildCandidate({
          candidateKey: "doc:doc-1:block-a:asset-a",
          assetId: "asset-a",
          label: "video-a.mp4 | Doc 1 | block:block-a",
          docId: "doc-1",
          docTitle: "Doc 1",
        }),
      ],
    },
    skillDocIds: ["doc-1"],
    sourceIntent: "command",
    fullAccess: true,
  });

  assert.equal(singleResult.requiredInput, null);
  assert.equal(singleResult.skillArgs.asset_id, "asset-a");

  const batchResult = await runDocAgent({
    userId: "user-1",
    matchedSkillId: "native:media-transcribe",
    skillArgs: {
      target_mode: "all",
      __media_candidates: [
        buildCandidate({
          candidateKey: "doc:doc-1:block-a:asset-a",
          assetId: "asset-a",
          label: "video-a.mp4 | Doc 1 | block:block-a",
          docId: "doc-1",
          docTitle: "Doc 1",
        }),
        buildCandidate({
          candidateKey: "doc:doc-1:block-b:asset-b",
          assetId: "asset-b",
          label: "video-b.mp4 | Doc 1 | block:block-b",
          docId: "doc-1",
          docTitle: "Doc 1",
        }),
      ],
    },
    skillDocIds: ["doc-1"],
    sourceIntent: "command",
    fullAccess: true,
  });

  assert.equal(batchResult.requiredInput, null);
  assert.deepEqual(batchResult.skillArgs.asset_ids, ["asset-a", "asset-b"]);
});
