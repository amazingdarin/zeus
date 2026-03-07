import assert from "node:assert/strict";
import { test } from "node:test";

import { insertDuplicateIntoTree } from "../src/features/document-page/duplicate-state";

type TreeDoc = {
  id: string;
  title: string;
  parentId: string;
};

test("insert duplicate into root list right after source document", () => {
  const root: TreeDoc[] = [
    { id: "a", title: "A", parentId: "root" },
    { id: "b", title: "B", parentId: "root" },
    { id: "c", title: "C", parentId: "root" },
  ];
  const children: Record<string, TreeDoc[]> = {};
  const duplicate: TreeDoc = { id: "b-copy", title: "B（副本）", parentId: "root" };

  const result = insertDuplicateIntoTree(root, children, "b", duplicate);

  assert.equal(result.changed, true);
  assert.deepEqual(result.rootDocuments.map((item) => item.id), ["a", "b", "b-copy", "c"]);
  assert.equal(result.childrenByParent, children);
});

test("insert duplicate into nested children list right after source document", () => {
  const root: TreeDoc[] = [{ id: "p", title: "Parent", parentId: "root" }];
  const children: Record<string, TreeDoc[]> = {
    p: [
      { id: "x", title: "X", parentId: "p" },
      { id: "y", title: "Y", parentId: "p" },
    ],
  };
  const duplicate: TreeDoc = { id: "x-copy", title: "X（副本）", parentId: "p" };

  const result = insertDuplicateIntoTree(root, children, "x", duplicate);

  assert.equal(result.changed, true);
  assert.equal(result.rootDocuments, root);
  assert.deepEqual(result.childrenByParent.p.map((item) => item.id), ["x", "x-copy", "y"]);
});

test("insert duplicate appends when source is not found in sibling list", () => {
  const root: TreeDoc[] = [{ id: "a", title: "A", parentId: "root" }];
  const children: Record<string, TreeDoc[]> = {};
  const duplicate: TreeDoc = { id: "new-copy", title: "新副本", parentId: "root" };

  const result = insertDuplicateIntoTree(root, children, "missing", duplicate);

  assert.deepEqual(result.rootDocuments.map((item) => item.id), ["a", "new-copy"]);
});

test("insert duplicate repositions existing duplicate entry to target location", () => {
  const root: TreeDoc[] = [
    { id: "a", title: "A", parentId: "root" },
    { id: "dup", title: "A（副本）", parentId: "root" },
    { id: "b", title: "B", parentId: "root" },
  ];
  const children: Record<string, TreeDoc[]> = {};
  const duplicate: TreeDoc = { id: "dup", title: "A（副本）", parentId: "root" };

  const result = insertDuplicateIntoTree(root, children, "a", duplicate);

  assert.deepEqual(result.rootDocuments.map((item) => item.id), ["a", "dup", "b"]);
});

