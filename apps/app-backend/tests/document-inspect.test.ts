import assert from "node:assert/strict";
import { test } from "node:test";

import { inspectDocumentSnapshot } from "../src/services/document-inspect.ts";

test("inspectDocumentSnapshot returns meta + block attrs without body by default", async () => {
  const snapshot = await inspectDocumentSnapshot(
    {
      userId: "u1",
      projectKey: "p1",
      docId: "doc-1",
      includeContent: false,
      includeBlockAttrs: true,
      blockTypes: ["file_block"],
    },
    {
      getDocument: async () => ({
        meta: {
          id: "doc-1",
          schema_version: "v1",
          title: "Doc 1",
          slug: "doc-1",
          path: "doc-1.json",
          parent_id: "root",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
        body: {
          type: "tiptap",
          content: {
            meta: {
              editor: "zeus-doc-editor",
            },
            content: {
              type: "doc",
              content: [
                {
                  type: "file_block",
                  attrs: {
                    id: "block-a",
                    asset_id: "asset-a",
                    file_name: "meeting.mp4",
                    mime: "video/mp4",
                  },
                },
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "hello" }],
                },
              ],
            },
          },
        },
      }),
    },
  );

  assert.equal(snapshot.docId, "doc-1");
  assert.equal(snapshot.title, "Doc 1");
  assert.equal(snapshot.body, undefined);
  assert.equal(snapshot.blocks.length, 1);
  assert.equal(snapshot.blocks[0]?.type, "file_block");
  assert.equal(snapshot.blocks[0]?.id, "block-a");
});

test("inspectDocumentSnapshot returns body when includeContent=true", async () => {
  const snapshot = await inspectDocumentSnapshot(
    {
      userId: "u1",
      projectKey: "p1",
      docId: "doc-2",
      includeContent: true,
      includeBlockAttrs: false,
    },
    {
      getDocument: async () => ({
        meta: {
          id: "doc-2",
          schema_version: "v1",
          title: "Doc 2",
          slug: "doc-2",
          path: "doc-2.json",
          parent_id: "root",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
        body: {
          type: "markdown",
          content: "# Title",
        },
      }),
    },
  );

  assert.equal(snapshot.blocks.length, 0);
  assert(snapshot.body);
  assert.equal(snapshot.body?.type, "markdown");
});
