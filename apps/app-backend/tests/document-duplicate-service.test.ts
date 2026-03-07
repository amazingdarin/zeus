import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { test } from "node:test";

import { documentStore, DocumentNotFoundError } from "../src/storage/document-store.ts";
import { getScopedDocsRoot } from "../src/storage/paths.ts";
import { duplicateDocument } from "../src/services/document-duplicate.ts";

const USER_ID = "document-duplicate-user";
const PROJECT_KEY = `personal::${USER_ID}::document-duplicate-demo`;

async function cleanup(): Promise<void> {
  await rm(getScopedDocsRoot(USER_ID, PROJECT_KEY), { recursive: true, force: true });
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

test("duplicate document creates a sibling copy with copied body", async () => {
  await cleanup();

  const source = await createTextDocument({
    id: "doc-source",
    title: "需求文档",
    text: "原始内容",
  });

  const copied = await duplicateDocument({
    userId: USER_ID,
    projectKey: PROJECT_KEY,
    docId: source.meta.id,
  });

  assert.notEqual(copied.meta.id, source.meta.id);
  assert.equal(copied.meta.parent_id, "root");
  assert.equal(copied.meta.title, "需求文档（副本）");
  assert.deepEqual(copied.body, source.body);

  await cleanup();
});

test("duplicate document increments suffix when copy titles already exist", async () => {
  await cleanup();

  const source = await createTextDocument({
    id: "doc-source-2",
    title: "周报",
    text: "报告正文",
  });
  await createTextDocument({
    id: "doc-copy-1",
    title: "周报（副本）",
    text: "copy-1",
  });
  await createTextDocument({
    id: "doc-copy-2",
    title: "周报（副本2）",
    text: "copy-2",
  });

  const copied = await duplicateDocument({
    userId: USER_ID,
    projectKey: PROJECT_KEY,
    docId: source.meta.id,
  });

  assert.equal(copied.meta.title, "周报（副本3）");

  await cleanup();
});

test("duplicate document keeps the same parent for nested document", async () => {
  await cleanup();

  const parent = await createTextDocument({
    id: "doc-parent",
    title: "目录",
  });
  const source = await createTextDocument({
    id: "doc-child",
    title: "子文档",
    parentId: parent.meta.id,
    text: "child",
  });

  const copied = await duplicateDocument({
    userId: USER_ID,
    projectKey: PROJECT_KEY,
    docId: source.meta.id,
  });

  assert.equal(copied.meta.parent_id, parent.meta.id);
  assert.equal(copied.meta.title, "子文档（副本）");

  const children = await documentStore.getChildren(USER_ID, PROJECT_KEY, parent.meta.id);
  assert.deepEqual(children.map((item) => item.title), ["子文档", "子文档（副本）"]);

  await cleanup();
});

test("duplicate document throws not found for missing source", async () => {
  await cleanup();

  await assert.rejects(
    () =>
      duplicateDocument({
        userId: USER_ID,
        projectKey: PROJECT_KEY,
        docId: "missing-doc",
      }),
    (err: unknown) => err instanceof DocumentNotFoundError,
  );

  await cleanup();
});
