import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isMeaningfulDraftChange,
  mapSaveStatusText,
  shouldPersistWorkspacePayload,
} from "../src/features/document-editor/workspace-model";

test("draft change detection: default title + empty doc is not meaningful", () => {
  assert.equal(
    isMeaningfulDraftChange({
      title: "无标题文档",
      content: { type: "doc", content: [] },
      defaultTitle: "无标题文档",
    }),
    false,
  );
});

test("draft change detection: default editor empty paragraph is not meaningful", () => {
  assert.equal(
    isMeaningfulDraftChange({
      title: "无标题文档",
      content: {
        type: "doc",
        content: [{ type: "paragraph" }],
      },
      defaultTitle: "无标题文档",
    }),
    false,
  );
  assert.equal(
    isMeaningfulDraftChange({
      title: "无标题文档",
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "   " }],
          },
        ],
      },
      defaultTitle: "无标题文档",
    }),
    false,
  );
});

test("draft change detection: title change or content change is meaningful", () => {
  assert.equal(
    isMeaningfulDraftChange({
      title: "需求说明",
      content: { type: "doc", content: [] },
      defaultTitle: "无标题文档",
    }),
    true,
  );
  assert.equal(
    isMeaningfulDraftChange({
      title: "无标题文档",
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }],
      },
      defaultTitle: "无标题文档",
    }),
    true,
  );
});

test("save status text includes draft state", () => {
  assert.equal(mapSaveStatusText("draft"), "草稿");
});

test("persist guard blocks ephemeral draft until materialized", () => {
  assert.equal(
    shouldPersistWorkspacePayload({
      persistMode: "ephemeral",
      hasMaterialized: false,
    }),
    false,
  );
  assert.equal(
    shouldPersistWorkspacePayload({
      persistMode: "ephemeral",
      hasMaterialized: true,
    }),
    true,
  );
  assert.equal(
    shouldPersistWorkspacePayload({
      persistMode: "persisted",
      hasMaterialized: false,
    }),
    true,
  );
});
