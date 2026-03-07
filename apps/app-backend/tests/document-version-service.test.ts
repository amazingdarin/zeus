import assert from "node:assert/strict";
import { test } from "node:test";

import { createDocumentVersionService } from "../src/services/document-version/service.ts";

test("document-version-service: creates one commit per document.update event", async () => {
  const commitMessages: string[] = [];

  const service = createDocumentVersionService({
    gitRepo: {
      ensureRepository: async () => {},
      add: async () => {},
      hasChanges: async () => true,
      hasCommits: async () => true,
      commit: async (_projectRoot, message) => {
        commitMessages.push(message);
        return "commit-sha-1";
      },
      ensureRemote: async () => {},
      pushForceWithLease: async () => {},
      createTag: async () => {},
    },
    getProjectRoot: () => "/tmp/project-root",
    getGeneralSettings: async () => ({
      useRemoteKnowledgeBase: false,
      documentAutoSync: false,
    }),
    resolveRemoteRepoUrl: async () => null,
  });

  await service.recordVersion({
    userId: "user-1",
    projectKey: "personal::user-1::demo",
    event: "document.update",
    payload: {
      docId: "d1",
      title: "Test Doc",
    },
    isAuthenticated: false,
  });

  assert.equal(commitMessages.length, 1);
  assert.match(commitMessages[0], /^docs\(update\): d1/);
});

test("document-version-service: syncOnOpen force-pushes when remote sync is enabled", async () => {
  const events: string[] = [];

  const service = createDocumentVersionService({
    gitRepo: {
      ensureRepository: async () => {
        events.push("ensureRepository");
      },
      add: async () => {},
      hasChanges: async () => false,
      hasCommits: async () => true,
      commit: async () => "commit-sha-1",
      ensureRemote: async (_projectRoot, remoteUrl) => {
        events.push(`ensureRemote:${remoteUrl}`);
      },
      pushForceWithLease: async (_projectRoot, branch) => {
        events.push(`push:${branch}:force-with-lease`);
      },
      createTag: async (projectRoot, tagName) => {
        events.push(`tag:${projectRoot}:${tagName}`);
      },
    },
    getProjectRoot: () => "/tmp/project-root",
    getGeneralSettings: async () => ({
      useRemoteKnowledgeBase: false,
      documentAutoSync: true,
    }),
    resolveRemoteRepoUrl: async () => "https://example.com/demo.git",
    now: () => 1700000000000,
  });

  const result = await service.syncOnOpen({
    userId: "user-1",
    projectKey: "personal::user-1::demo",
    isAuthenticated: true,
    accessToken: "token",
    scope: {
      ownerType: "personal",
      ownerId: "user-1",
      projectKey: "demo",
    },
  });

  assert.equal(result.syncMode, "remote_enabled");
  assert.equal(result.synced, true);
  assert(events.some((item) => item.startsWith("tag:/tmp/project-root:backup/pre-force-")));
  assert(events.includes("ensureRemote:https://example.com/demo.git"));
  assert(events.includes("push:main:force-with-lease"));
});

test("document-version-service: reports sync failure to message center when push fails", async () => {
  const createdTasks: Array<Record<string, unknown>> = [];
  const failedTasks: Array<{
    userId: string;
    projectKey: string;
    taskId: string;
    errorMessage: string;
  }> = [];

  const service = createDocumentVersionService({
    gitRepo: {
      ensureRepository: async () => {},
      add: async () => {},
      hasChanges: async () => false,
      hasCommits: async () => true,
      commit: async () => "commit-sha-1",
      ensureRemote: async () => {},
      pushForceWithLease: async () => {
        throw new Error("push rejected");
      },
      createTag: async () => {},
    },
    getProjectRoot: () => "/tmp/project-root",
    getGeneralSettings: async () => ({
      useRemoteKnowledgeBase: false,
      documentAutoSync: true,
    }),
    resolveRemoteRepoUrl: async () => "https://example.com/demo.git",
    createMessageTask: async (input) => {
      createdTasks.push(input as unknown as Record<string, unknown>);
      return { id: "task-1" } as any;
    },
    failMessageTask: async (userId, projectKey, taskId, errorMessage) => {
      failedTasks.push({ userId, projectKey, taskId, errorMessage });
      return null;
    },
    now: () => 1700000000000,
  });

  await assert.rejects(async () => {
    await service.syncOnOpen({
      userId: "user-1",
      projectKey: "personal::user-1::demo",
      isAuthenticated: true,
      accessToken: "token",
      scope: {
        ownerType: "personal",
        ownerId: "user-1",
        projectKey: "demo",
      },
    });
  }, /push rejected/);

  assert.equal(createdTasks.length, 1);
  assert.equal(createdTasks[0]?.type, "document-sync");
  assert.equal(createdTasks[0]?.status, "running");
  assert.equal(createdTasks[0]?.title, "文档同步");
  const detail = (createdTasks[0]?.detail ?? {}) as Record<string, unknown>;
  assert.equal(detail.syncMode, "remote_enabled");
  assert.equal(detail.trigger, "sync-on-open");
  assert.equal(detail.source, "document-version-service");

  assert.equal(failedTasks.length, 1);
  assert.deepEqual(failedTasks[0], {
    userId: "user-1",
    projectKey: "personal::user-1::demo",
    taskId: "task-1",
    errorMessage: "push rejected",
  });
});
