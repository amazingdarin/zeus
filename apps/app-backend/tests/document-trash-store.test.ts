import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { test } from "node:test";

import { documentStore, DocumentNotFoundError } from "../src/storage/document-store.ts";
import { getScopedDocsRoot } from "../src/storage/paths.ts";
import { createDocumentTrashStore } from "../src/services/document-trash/store.ts";

const USER_ID = "trash-user";
const PROJECT_KEY = `personal::${USER_ID}::trash-demo`;

function docsRoot() {
  return getScopedDocsRoot(USER_ID, PROJECT_KEY);
}

async function cleanup(): Promise<void> {
  await rm(docsRoot(), { recursive: true, force: true });
}

async function createTextDocument(input: {
  id: string;
  title: string;
  parentId?: string;
  text?: string;
}) {
  const now = new Date().toISOString();
  return documentStore.save(USER_ID, PROJECT_KEY, {
    meta: {
      id: input.id,
      schema_version: "v1",
      title: input.title,
      slug: input.id,
      path: "",
      parent_id: input.parentId ?? "root",
      created_at: now,
      updated_at: now,
    },
    body: {
      type: "tiptap",
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: input.text
              ? [{ type: "text", text: input.text }]
              : [],
          },
        ],
      },
    },
  });
}

test("document-trash-store: move directory into single trash entry with subtree ids", async () => {
  await cleanup();

  await createTextDocument({ id: "parent", title: "父目录" });
  await createTextDocument({ id: "child-a", title: "子文档A", parentId: "parent", text: "A" });
  await createTextDocument({ id: "child-b", title: "子文档B", parentId: "parent", text: "B" });

  const trashStore = createDocumentTrashStore();
  const moved = await trashStore.moveToTrash({
    userId: USER_ID,
    projectKey: PROJECT_KEY,
    docId: "parent",
    recursive: true,
    deletedBy: USER_ID,
  });

  assert.equal(moved.entry.entityType, "directory");
  assert.equal(moved.entry.rootDocId, "parent");
  assert.deepEqual(new Set(moved.deletedIds), new Set(["parent", "child-a", "child-b"]));

  await assert.rejects(
    () => documentStore.get(USER_ID, PROJECT_KEY, "parent"),
    (err: unknown) => err instanceof DocumentNotFoundError,
  );

  const listed = await trashStore.list({ userId: USER_ID, projectKey: PROJECT_KEY });
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.trashId, moved.entry.trashId);

  await cleanup();
});

test("document-trash-store: restore falls back to root and auto-renames on conflict", async () => {
  await cleanup();

  await createTextDocument({ id: "missing-parent", title: "将被删除的父节点" });
  await createTextDocument({ id: "restore-doc", title: "同名文档", parentId: "missing-parent", text: "restore" });

  const trashStore = createDocumentTrashStore();
  const moved = await trashStore.moveToTrash({
    userId: USER_ID,
    projectKey: PROJECT_KEY,
    docId: "restore-doc",
    recursive: true,
    deletedBy: USER_ID,
  });

  await documentStore.delete(USER_ID, PROJECT_KEY, "missing-parent", true);
  await createTextDocument({ id: "root-dup", title: "同名文档", text: "dup" });

  const restored = await trashStore.restore({
    userId: USER_ID,
    projectKey: PROJECT_KEY,
    trashId: moved.entry.trashId,
  });

  assert.equal(restored.root.meta.parent_id, "root");
  assert.equal(restored.fallbackToRoot, true);
  assert.match(restored.root.meta.title, /^同名文档（恢复\d*）?$/);

  const listed = await trashStore.list({ userId: USER_ID, projectKey: PROJECT_KEY });
  assert.equal(listed.length, 0);

  await cleanup();
});

test("document-trash-store: purge one and purge all", async () => {
  await cleanup();

  await createTextDocument({ id: "doc-1", title: "文档1" });
  await createTextDocument({ id: "doc-2", title: "文档2" });

  const trashStore = createDocumentTrashStore();
  const moved1 = await trashStore.moveToTrash({
    userId: USER_ID,
    projectKey: PROJECT_KEY,
    docId: "doc-1",
    recursive: true,
    deletedBy: USER_ID,
  });
  await trashStore.moveToTrash({
    userId: USER_ID,
    projectKey: PROJECT_KEY,
    docId: "doc-2",
    recursive: true,
    deletedBy: USER_ID,
  });

  const purgedOne = await trashStore.purgeOne({
    userId: USER_ID,
    projectKey: PROJECT_KEY,
    trashId: moved1.entry.trashId,
  });
  assert.equal(purgedOne.purged, true);

  const beforeAll = await trashStore.list({ userId: USER_ID, projectKey: PROJECT_KEY });
  assert.equal(beforeAll.length, 1);

  const purgedAll = await trashStore.purgeAll({ userId: USER_ID, projectKey: PROJECT_KEY });
  assert.equal(purgedAll.count, 1);

  const afterAll = await trashStore.list({ userId: USER_ID, projectKey: PROJECT_KEY });
  assert.equal(afterAll.length, 0);

  await cleanup();
});
