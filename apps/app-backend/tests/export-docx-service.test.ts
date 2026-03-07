import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { test } from "node:test";

import { documentStore } from "../src/storage/document-store.ts";
import { assetStore } from "../src/storage/asset-store.ts";
import { getScopedAssetsRoot, getScopedDocsRoot } from "../src/storage/paths.ts";
import { exportDocumentToDocxBuffer, ExportDocxError } from "../src/services/export-docx.ts";

const USER_ID = "word-export-user";
const PROJECT_KEY = `personal::${USER_ID}::word-export-demo`;

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7+3hQAAAAASUVORK5CYII=";

async function cleanup(): Promise<void> {
  await rm(getScopedDocsRoot(USER_ID, PROJECT_KEY), { recursive: true, force: true });
  await rm(getScopedAssetsRoot(USER_ID, PROJECT_KEY), { recursive: true, force: true });
}

test("export docx service returns binary and filename", async () => {
  await cleanup();

  const now = new Date().toISOString();
  const docId = `doc-basic-${Date.now()}`;
  await documentStore.save(USER_ID, PROJECT_KEY, {
    meta: {
      id: docId,
      schema_version: "v1",
      title: "导出测试文档",
      slug: docId,
      path: "",
      parent_id: "root",
      created_at: now,
      updated_at: now,
    },
    body: {
      type: "tiptap",
      content: {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "标题" }] },
          { type: "paragraph", content: [{ type: "text", text: "正文段落" }] },
        ],
      },
    },
  });

  const result = await exportDocumentToDocxBuffer({
    userId: USER_ID,
    projectKey: PROJECT_KEY,
    docId,
  });

  assert.equal(result.buffer.length > 0, true);
  assert.equal(result.filename.endsWith(".docx"), true);
  assert.equal(
    result.contentType,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  assert.equal(result.imageEmbeddedCount, 0);
  assert.equal(result.imageFallbackCount, 0);

  await cleanup();
});

test("export docx service embeds image by asset id in url", async () => {
  await cleanup();

  const asset = await assetStore.save(
    USER_ID,
    PROJECT_KEY,
    "tiny.png",
    "image/png",
    Buffer.from(TINY_PNG_BASE64, "base64"),
  );

  const docId = `doc-image-${Date.now()}`;
  const now = new Date().toISOString();
  await documentStore.save(USER_ID, PROJECT_KEY, {
    meta: {
      id: docId,
      schema_version: "v1",
      title: "图片导出",
      slug: docId,
      path: "",
      parent_id: "root",
      created_at: now,
      updated_at: now,
    },
    body: {
      type: "tiptap",
      content: {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: {
              src: `/api/projects/personal/me/demo/assets/${asset.id}/content`,
              alt: "tiny",
              title: "tiny",
            },
          },
        ],
      },
    },
  });

  const result = await exportDocumentToDocxBuffer({
    userId: USER_ID,
    projectKey: PROJECT_KEY,
    docId,
  });

  assert.equal(result.buffer.length > 0, true);
  assert.equal(result.imageEmbeddedCount, 1);
  assert.equal(result.imageFallbackCount, 0);

  await cleanup();
});

test("export docx service falls back when image cannot resolve", async () => {
  await cleanup();

  const docId = `doc-image-fallback-${Date.now()}`;
  const now = new Date().toISOString();
  await documentStore.save(USER_ID, PROJECT_KEY, {
    meta: {
      id: docId,
      schema_version: "v1",
      title: "图片降级",
      slug: docId,
      path: "",
      parent_id: "root",
      created_at: now,
      updated_at: now,
    },
    body: {
      type: "tiptap",
      content: {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: {
              src: "/api/projects/personal/me/demo/assets/not-found/content",
              alt: "missing",
            },
          },
        ],
      },
    },
  });

  const result = await exportDocumentToDocxBuffer({
    userId: USER_ID,
    projectKey: PROJECT_KEY,
    docId,
  });

  assert.equal(result.buffer.length > 0, true);
  assert.equal(result.imageEmbeddedCount, 0);
  assert.equal(result.imageFallbackCount, 1);

  await cleanup();
});

test("export docx service throws EMPTY_DOCUMENT for empty tiptap content", async () => {
  await cleanup();

  const docId = `doc-empty-${Date.now()}`;
  const now = new Date().toISOString();
  await documentStore.save(USER_ID, PROJECT_KEY, {
    meta: {
      id: docId,
      schema_version: "v1",
      title: "空文档",
      slug: docId,
      path: "",
      parent_id: "root",
      created_at: now,
      updated_at: now,
    },
    body: {
      type: "tiptap",
      content: {
        type: "doc",
        content: [],
      },
    },
  });

  await assert.rejects(
    () => exportDocumentToDocxBuffer({ userId: USER_ID, projectKey: PROJECT_KEY, docId }),
    (err: unknown) => err instanceof ExportDocxError && err.code === "EMPTY_DOCUMENT",
  );

  await cleanup();
});
