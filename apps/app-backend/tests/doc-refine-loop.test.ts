import assert from "node:assert/strict";
import { test } from "node:test";

import { runDraftRefinementLoop } from "../src/llm/skills/refinement-loop.ts";
import type { DocumentDraft, SkillStreamChunk } from "../src/llm/skills/types.ts";

function makeDraft(input: {
  id: string;
  originalContent: any;
  proposedContent: any;
}): DocumentDraft {
  return {
    id: input.id,
    userId: "u1",
    projectKey: "p1",
    docId: "doc-1",
    parentId: null,
    title: "t1",
    originalContent: input.originalContent,
    proposedContent: input.proposedContent,
    status: "pending",
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  };
}

test("runDraftRefinementLoop retries once and appends feedback into args", async () => {
  const original = {
    type: "doc",
    content: [
      { type: "paragraph", attrs: { id: "a" }, content: [{ type: "text", text: "A" }] },
      { type: "paragraph", attrs: { id: "b" }, content: [{ type: "text", text: "B" }] },
    ],
  };

  const proposedAttempt1 = {
    type: "doc",
    content: [
      { type: "paragraph", attrs: { id: "a" }, content: [{ type: "text", text: "A" }] },
      // Missing "b" -> should fail additive strict
    ],
  };

  const proposedAttempt2 = {
    type: "doc",
    content: [
      { type: "paragraph", attrs: { id: "a" }, content: [{ type: "text", text: "A" }] },
      { type: "paragraph", attrs: { id: "b" }, content: [{ type: "text", text: "B" }] },
      { type: "paragraph", attrs: { id: "c" }, content: [{ type: "text", text: "C (added)" }] },
    ],
  };

  let callCount = 0;
  const seenArgs: Array<Record<string, unknown>> = [];
  const deletedDraftIds: string[] = [];

  const runAttempt = async function* (args: Record<string, unknown>): AsyncGenerator<SkillStreamChunk> {
    seenArgs.push(args);
    callCount += 1;

    if (callCount === 1) {
      yield { type: "thinking", content: "attempt1" };
      yield {
        type: "draft",
        draft: makeDraft({
          id: "d1",
          originalContent: original,
          proposedContent: proposedAttempt1,
        }),
      };
      yield { type: "done", message: "done1" };
      return;
    }

    yield { type: "thinking", content: "attempt2" };
    yield {
      type: "draft",
      draft: makeDraft({
        id: "d2",
        originalContent: original,
        proposedContent: proposedAttempt2,
      }),
    };
    yield { type: "done", message: "done2" };
  };

  const stream = runDraftRefinementLoop({
    skillLegacyName: "doc-edit",
    userMessage: "请添加摘要",
    baseArgs: { instructions: "请添加摘要" },
    maxAttempts: 3,
    runAttempt,
    deleteDraft: (id) => {
      deletedDraftIds.push(id);
      return true;
    },
  });

  const chunks: SkillStreamChunk[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  assert.equal(callCount, 2);
  assert.deepEqual(deletedDraftIds, ["d1"]);
  assert.equal(seenArgs.length, 2);
  assert.equal(typeof seenArgs[1].instructions, "string");
  assert.equal((seenArgs[1].instructions as string).includes("【校验反馈】"), true);

  const draftChunk = chunks.find((c) => c.type === "draft") as Extract<SkillStreamChunk, { type: "draft" }> | undefined;
  assert(draftChunk);
  assert.equal(draftChunk.draft.validation?.passed, true);
  assert.equal(draftChunk.draft.validation?.attempt, 2);

  const doneChunk = chunks.find((c) => c.type === "done") as Extract<SkillStreamChunk, { type: "done" }> | undefined;
  assert(doneChunk);
  assert.equal(doneChunk.message, "done2");
});

