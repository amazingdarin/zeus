import assert from "node:assert/strict";
import { test } from "node:test";

import {
  mapHierarchyToBreadcrumb,
  normalizeDocumentDisplayTitle,
  updateTitleInDocumentMap,
  updateTitleInTree,
} from "../src/features/document-page/title-sync";

type TreeNode = {
  id: string;
  title: string;
};

test("normalizes empty or whitespace title to fallback display title", () => {
  assert.equal(normalizeDocumentDisplayTitle(""), "无标题文档");
  assert.equal(normalizeDocumentDisplayTitle("   "), "无标题文档");
  assert.equal(normalizeDocumentDisplayTitle("  新标题  "), "新标题");
});

test("updates matching title in root list", () => {
  const root: TreeNode[] = [
    { id: "a", title: "A" },
    { id: "b", title: "B" },
  ];
  const children: Record<string, TreeNode[]> = {};
  const result = updateTitleInTree(root, children, "b", "B2");

  assert.equal(result.changed, true);
  assert.deepEqual(result.rootDocuments, [
    { id: "a", title: "A" },
    { id: "b", title: "B2" },
  ]);
  assert.equal(result.childrenByParent, children);
});

test("updates matching title in children map", () => {
  const root: TreeNode[] = [{ id: "root", title: "Root" }];
  const children: Record<string, TreeNode[]> = {
    root: [
      { id: "x", title: "X" },
      { id: "y", title: "Y" },
    ],
  };
  const result = updateTitleInTree(root, children, "x", "X2");

  assert.equal(result.changed, true);
  assert.equal(result.rootDocuments, root);
  assert.deepEqual(result.childrenByParent.root, [
    { id: "x", title: "X2" },
    { id: "y", title: "Y" },
  ]);
});

test("keeps original references when nothing changes", () => {
  const root: TreeNode[] = [{ id: "a", title: "A" }];
  const children: Record<string, TreeNode[]> = {
    a: [{ id: "b", title: "B" }],
  };
  const result = updateTitleInTree(root, children, "c", "C");

  assert.equal(result.changed, false);
  assert.equal(result.rootDocuments, root);
  assert.equal(result.childrenByParent, children);
});

test("updates matching title in documents map for tab/document sync", () => {
  const docsById = {
    a: { id: "a", title: "A", parentId: "root" },
    b: { id: "b", title: "B", parentId: "root" },
  };
  const result = updateTitleInDocumentMap(docsById, "b", "B2");

  assert.equal(result.changed, true);
  assert.deepEqual(result.documentsById.b, { id: "b", title: "B2", parentId: "root" });
  assert.deepEqual(result.documentsById.a, docsById.a);
});

test("keeps documents map reference when title map update is noop", () => {
  const docsById = {
    a: { id: "a", title: "A", parentId: "root" },
  };

  const missing = updateTitleInDocumentMap(docsById, "x", "X");
  assert.equal(missing.changed, false);
  assert.equal(missing.documentsById, docsById);

  const same = updateTitleInDocumentMap(docsById, "a", "A");
  assert.equal(same.changed, false);
  assert.equal(same.documentsById, docsById);
});

test("breadcrumb uses latest edited title for current document", () => {
  const hierarchy = [
    { id: "root", name: "Root" },
    { id: "doc-1", name: "旧标题" },
  ];

  const result = mapHierarchyToBreadcrumb(hierarchy, "doc-1", "新标题");

  assert.deepEqual(result, [
    { label: "Root", to: "/documents/root" },
    { label: "新标题", to: "/documents/doc-1" },
  ]);
});

test("breadcrumb falls back to document entry when hierarchy is empty", () => {
  const result = mapHierarchyToBreadcrumb([], "doc-2", "标题");

  assert.deepEqual(result, [{ label: "标题", to: "/documents/doc-2" }]);
});
