import assert from "node:assert/strict";
import { after, test } from "node:test";

import { closePool, query } from "../src/db/postgres.ts";
import { resolveProjectScope } from "../src/project-scope.ts";
import {
  CommentThreadNotFoundError,
  documentBlockCommentStore,
} from "../src/services/document-block-comment-store.ts";

async function canConnect(): Promise<boolean> {
  try {
    await query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

function randomId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

async function cleanupByScope(userId: string, projectRef: string): Promise<void> {
  const scope = resolveProjectScope(userId, projectRef);
  await query(
    `DELETE FROM document_block_comment_messages
      WHERE thread_id IN (
        SELECT id
          FROM document_block_comment_threads
         WHERE owner_type = $1
           AND owner_id = $2
           AND project_key = $3
      )`,
    [scope.ownerType, scope.ownerId, scope.projectKey],
  );
  await query(
    `DELETE FROM document_block_comment_threads
      WHERE owner_type = $1
        AND owner_id = $2
        AND project_key = $3`,
    [scope.ownerType, scope.ownerId, scope.projectKey],
  );
}

after(async () => {
  await closePool();
});

test("block comment store supports thread/message lifecycle", async (t) => {
  if (!(await canConnect())) {
    t.skip("PostgreSQL not available");
    return;
  }

  const userId = randomId("user");
  const projectRef = `personal::${userId}::${randomId("project")}`;
  const docId = randomId("doc");
  const blockId = randomId("block");

  try {
    const created = await documentBlockCommentStore.createThread({
      userId,
      projectKey: projectRef,
      docId,
      blockId,
      content: "first message",
    });
    assert.equal(created.thread.docId, docId);
    assert.equal(created.thread.blockId, blockId);
    assert.equal(created.thread.status, "open");
    assert.equal(created.messages.length, 1);

    const reply = await documentBlockCommentStore.addMessage({
      userId,
      projectKey: projectRef,
      docId,
      threadId: created.thread.id,
      content: "reply message",
    });
    assert.equal(reply.threadId, created.thread.id);
    assert.equal(reply.content, "reply message");

    const threadAfterReply = await documentBlockCommentStore.getThread({
      userId,
      projectKey: projectRef,
      docId,
      threadId: created.thread.id,
    });
    assert.equal(threadAfterReply.messages.length, 2);

    const listed = await documentBlockCommentStore.listThreads({
      userId,
      projectKey: projectRef,
      docId,
      blockId,
      limit: 10,
    });
    assert.equal(listed.items.length, 1);
    assert.equal(listed.items[0]?.thread.id, created.thread.id);
    assert.equal(listed.items[0]?.messages.length, 2);

    const resolved = await documentBlockCommentStore.setThreadStatus({
      userId,
      projectKey: projectRef,
      docId,
      threadId: created.thread.id,
      status: "resolved",
    });
    assert.equal(resolved.status, "resolved");
    assert.equal(Boolean(resolved.resolvedBy), true);

    const reopened = await documentBlockCommentStore.setThreadStatus({
      userId,
      projectKey: projectRef,
      docId,
      threadId: created.thread.id,
      status: "open",
    });
    assert.equal(reopened.status, "open");

    const found = await documentBlockCommentStore.findMessage({
      userId,
      projectKey: projectRef,
      docId,
      messageId: reply.id,
    });
    assert.equal(found.message.id, reply.id);
    assert.equal(found.thread.id, created.thread.id);

    await documentBlockCommentStore.deleteMessage({
      userId,
      projectKey: projectRef,
      docId,
      messageId: reply.id,
    });
    const threadAfterDelete = await documentBlockCommentStore.getThread({
      userId,
      projectKey: projectRef,
      docId,
      threadId: created.thread.id,
    });
    assert.equal(threadAfterDelete.messages.length, 1);
  } finally {
    await cleanupByScope(userId, projectRef);
  }
});

test("block comment store enforces scoped isolation", async (t) => {
  if (!(await canConnect())) {
    t.skip("PostgreSQL not available");
    return;
  }

  const userId = randomId("user");
  const projectRefA = `personal::${userId}::${randomId("project-a")}`;
  const projectRefB = `personal::${userId}::${randomId("project-b")}`;
  const docId = randomId("doc");
  const blockId = randomId("block");

  try {
    const created = await documentBlockCommentStore.createThread({
      userId,
      projectKey: projectRefA,
      docId,
      blockId,
      content: "scope thread",
    });

    await assert.rejects(
      () => documentBlockCommentStore.getThread({
        userId,
        projectKey: projectRefB,
        docId,
        threadId: created.thread.id,
      }),
      (error: unknown) => error instanceof CommentThreadNotFoundError,
    );
  } finally {
    await cleanupByScope(userId, projectRefA);
    await cleanupByScope(userId, projectRefB);
  }
});
