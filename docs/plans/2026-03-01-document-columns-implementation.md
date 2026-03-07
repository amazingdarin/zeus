# 文档横向分栏容器块 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在文档编辑器中新增可插入与可编辑的横向分栏容器块，支持 `2列/3列/4列/5列` 与动态改列数。

**Architecture:** 采用语义化节点方案：新增 `columns`（容器）与 `column`（列）节点，并通过内置块菜单与 slash 快捷入口接入。列数调整在命令层完成，减列时迁移尾部列内容到最后保留列以避免数据丢失。移动端通过容器横向滚动保留分栏布局。

**Tech Stack:** Tiptap (`@tiptap/core`, `@tiptap/react`), React + TypeScript, Node test runner (`node --import tsx --test`), SCSS.

---

> 执行要求：全程遵循 @superpowers:test-driven-development 与 @superpowers:verification-before-completion。

### Task 1: 扩展内置块类型与块菜单（2/3/4/5 列）

**Files:**
- Modify: `packages/doc-editor/src/extensions/block-add-handle.ts`
- Modify: `packages/doc-editor/src/ui/block-add-menu.tsx`
- Modify: `packages/doc-editor/tests/block-add-handle.test.ts`

**Step 1: Write the failing test**

```ts
test("builtin block menu includes columns variants", () => {
  const ids = getBuiltinBlockItems().map((item) => item.id);
  assert.ok(ids.includes("columns-2"));
  assert.ok(ids.includes("columns-3"));
  assert.ok(ids.includes("columns-4"));
  assert.ok(ids.includes("columns-5"));
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/darin/mine/code/zeus && node --import tsx --test packages/doc-editor/tests/block-add-handle.test.ts`  
Expected: FAIL with missing block ids/type mismatch.

**Step 3: Write minimal implementation**

```ts
// block-add-handle.ts
export type BuiltinBlockType =
  // ...
  | "columns-2"
  | "columns-3"
  | "columns-4"
  | "columns-5";

export const BUILTIN_BLOCK_TYPES: BuiltinBlockType[] = [
  // ...
  "columns-2",
  "columns-3",
  "columns-4",
  "columns-5",
];

// block-add-menu.tsx
{ kind: "builtin", id: "columns-2", label: "2列", icon: <ColumnsIcon count={2} /> },
{ kind: "builtin", id: "columns-3", label: "3列", icon: <ColumnsIcon count={3} /> },
{ kind: "builtin", id: "columns-4", label: "4列", icon: <ColumnsIcon count={4} /> },
{ kind: "builtin", id: "columns-5", label: "5列", icon: <ColumnsIcon count={5} /> },
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/darin/mine/code/zeus && node --import tsx --test packages/doc-editor/tests/block-add-handle.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/doc-editor/src/extensions/block-add-handle.ts packages/doc-editor/src/ui/block-add-menu.tsx packages/doc-editor/tests/block-add-handle.test.ts
git commit -m "feat(doc-editor): add builtin columns block menu variants"
```

### Task 2: 实现分栏默认内容构造（standalone insertion）

**Files:**
- Modify: `packages/doc-editor/src/extensions/builtin-block-content.ts`
- Modify: `packages/doc-editor/tests/builtin-block-content.test.ts`

**Step 1: Write the failing test**

```ts
test("standalone insertion: columns-3 creates 3 editable columns", () => {
  const content = buildStandaloneBuiltinBlockContent("columns-3");
  assert.equal(content.type, "columns");
  assert.equal(content.attrs?.count, 3);
  assert.equal(content.content?.length, 3);
  assert.equal(content.content?.[0]?.type, "column");
  assert.equal(content.content?.[0]?.content?.[0]?.type, "paragraph");
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/darin/mine/code/zeus && node --import tsx --test packages/doc-editor/tests/builtin-block-content.test.ts`  
Expected: FAIL with unsupported builtin type.

**Step 3: Write minimal implementation**

```ts
function buildColumnsNode(count: 2 | 3 | 4 | 5): JSONContent {
  return {
    type: "columns",
    attrs: { count },
    content: Array.from({ length: count }, () => ({
      type: "column",
      content: [{ type: "paragraph" }],
    })),
  };
}

case "columns-2":
  return buildColumnsNode(2);
case "columns-3":
  return buildColumnsNode(3);
case "columns-4":
  return buildColumnsNode(4);
case "columns-5":
  return buildColumnsNode(5);
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/darin/mine/code/zeus && node --import tsx --test packages/doc-editor/tests/builtin-block-content.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/doc-editor/src/extensions/builtin-block-content.ts packages/doc-editor/tests/builtin-block-content.test.ts
git commit -m "feat(doc-editor): add standalone columns block content builders"
```

### Task 3: 新增 columns/column 节点扩展与核心变换函数

**Files:**
- Create: `packages/doc-editor/src/nodes/columns-node/columns-node-extension.ts`
- Create: `packages/doc-editor/src/nodes/columns-node/columns-transform.ts`
- Create: `packages/doc-editor/tests/columns-transform.test.ts`

**Step 1: Write the failing test**

```ts
test("resizeColumns shrinks and merges removed column content into last kept column", () => {
  const node = {
    type: "columns",
    attrs: { count: 4 },
    content: [
      { type: "column", content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }] },
      { type: "column", content: [{ type: "paragraph", content: [{ type: "text", text: "B" }] }] },
      { type: "column", content: [{ type: "paragraph", content: [{ type: "text", text: "C" }] }] },
      { type: "column", content: [{ type: "paragraph", content: [{ type: "text", text: "D" }] }] },
    ],
  } as const;
  const next = resizeColumnsJson(node, 2);
  assert.equal(next.attrs.count, 2);
  assert.equal(next.content.length, 2);
  assert.equal(next.content[1].content.length, 3);
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/darin/mine/code/zeus && node --import tsx --test packages/doc-editor/tests/columns-transform.test.ts`  
Expected: FAIL with missing module/function.

**Step 3: Write minimal implementation**

```ts
export function normalizeColumnsCount(value: unknown): 2 | 3 | 4 | 5 { /* clamp */ }

export function resizeColumnsJson(node: JSONContent, nextCount: number): JSONContent {
  // 1) normalize count
  // 2) expand: append empty column
  // 3) shrink: merge removed column blocks into last kept column
  // 4) return updated attrs.count + content
}
```

并在 `columns-node-extension.ts` 定义：

```ts
name: "columns" // group: block, content: "column+"
name: "column"  // content: "block+"

addCommands() {
  return {
    insertColumns: ({ count }) => ({ commands }) => commands.insertContent(buildColumnsNodeJson(count)),
    setColumnsCount: ({ pos, count }) => ({ tr, state, dispatch }) => { /* replace node at pos */ },
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/darin/mine/code/zeus && node --import tsx --test packages/doc-editor/tests/columns-transform.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/doc-editor/src/nodes/columns-node/columns-node-extension.ts packages/doc-editor/src/nodes/columns-node/columns-transform.ts packages/doc-editor/tests/columns-transform.test.ts
git commit -m "feat(doc-editor): add columns node schema and resize transform"
```

### Task 4: 接入节点注册与编辑器扩展列表

**Files:**
- Modify: `packages/doc-editor/src/nodes/index.ts`
- Modify: `packages/doc-editor/src/templates/simple/doc-editor.tsx`
- Modify: `packages/doc-editor/src/extensions/BlockIdExtension.ts`

**Step 1: Write the failing test**

```ts
test("columns node type receives block id", () => {
  const nodeTypes = getDocEditorBlockIdNodeTypes();
  assert.ok(nodeTypes.includes("columns"));
  assert.ok(nodeTypes.includes("column"));
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/darin/mine/code/zeus && node --import tsx --test packages/doc-editor/tests/block-add-handle.test.ts`  
Expected: FAIL (node types absent).

**Step 3: Write minimal implementation**

```ts
// nodes/index.ts
export * from "./columns-node/columns-node-extension";

// doc-editor.tsx extensions:
// ... MindmapNode,
// ColumnsNode,
// ...createTableExtensions(),

// BlockIdExtension.ts BASE_BLOCK_ID_NODE_TYPES add:
"columns",
"column",
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/darin/mine/code/zeus && npm run test:unified-editor -- packages/doc-editor/tests/block-add-handle.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/doc-editor/src/nodes/index.ts packages/doc-editor/src/templates/simple/doc-editor.tsx packages/doc-editor/src/extensions/BlockIdExtension.ts
git commit -m "feat(doc-editor): register columns extensions and block id coverage"
```

### Task 5: 接入内置插入、slash 快捷映射与“禁止嵌套”

**Files:**
- Modify: `packages/doc-editor/src/templates/simple/doc-editor.tsx`
- Modify: `apps/web/src/constants/document-block-shortcuts.ts`
- Modify: `apps/web/tests/general-settings-shortcuts.test.ts`
- Modify: `packages/doc-editor/tests/block-shortcut.test.ts`

**Step 1: Write the failing test**

```ts
test("document block shortcuts: supports columns shortcut mapping", () => {
  const data = sanitizeDocumentBlockShortcuts({
    "2col": "columns-2",
    "3col": "columns-3",
  });
  assert.equal(data["2col"], "columns-2");
  assert.equal(data["3col"], "columns-3");
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/darin/mine/code/zeus && node --import tsx --test apps/web/tests/general-settings-shortcuts.test.ts packages/doc-editor/tests/block-shortcut.test.ts`  
Expected: FAIL with type guards rejecting columns block types.

**Step 3: Write minimal implementation**

```ts
// constants/document-block-shortcuts.ts
// BuiltinBlockType union + DOCUMENT_BLOCK_SHORTCUT_FIELDS include columns-2..5
// DEFAULT_DOCUMENT_BLOCK_SHORTCUTS can stay unchanged

// doc-editor.tsx
case "columns-2": chain.insertColumns({ count: 2 }).run(); return;
case "columns-3": chain.insertColumns({ count: 3 }).run(); return;
case "columns-4": chain.insertColumns({ count: 4 }).run(); return;
case "columns-5": chain.insertColumns({ count: 5 }).run(); return;

// insert guard: when current selection is inside "column", reject insertColumns
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/darin/mine/code/zeus && npm run test:unified-editor -- apps/web/tests/general-settings-shortcuts.test.ts packages/doc-editor/tests/block-shortcut.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/doc-editor/src/templates/simple/doc-editor.tsx apps/web/src/constants/document-block-shortcuts.ts apps/web/tests/general-settings-shortcuts.test.ts packages/doc-editor/tests/block-shortcut.test.ts
git commit -m "feat(doc-editor): wire columns insertion and shortcut mappings"
```

### Task 6: 实现 NodeView 与移动端横向滚动样式

**Files:**
- Create: `packages/doc-editor/src/nodes/columns-node/columns-node.tsx`
- Create: `packages/doc-editor/src/nodes/columns-node/columns-node.scss`
- Modify: `packages/doc-editor/src/templates/simple/doc-editor.tsx`

**Step 1: Write the failing test**

```ts
test("columns node view class is present for layout styling", () => {
  // snapshot/string-based render check around rendered HTML attrs
  assert.match(renderedHtml, /data-type="columns"/);
  assert.match(renderedHtml, /doc-editor-columns/);
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/darin/mine/code/zeus && node --import tsx --test packages/doc-editor/tests/columns-transform.test.ts`  
Expected: FAIL (class/NodeView not wired).

**Step 3: Write minimal implementation**

```tsx
// columns-node.tsx
// - header toolbar: 2/3/4/5 switch + +/- controls
// - content: NodeViewContent as grid container
// - mobile: container supports overflow-x
```

```scss
.doc-editor-columns {
  overflow-x: auto;
}
.doc-editor-columns-track {
  display: grid;
  gap: 12px;
}
.doc-editor-columns[data-count="3"] .doc-editor-columns-track {
  grid-template-columns: repeat(3, minmax(220px, 1fr));
  min-width: calc(220px * 3 + 12px * 2);
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/darin/mine/code/zeus && npm run test:unified-editor -- packages/doc-editor/tests/columns-transform.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/doc-editor/src/nodes/columns-node/columns-node.tsx packages/doc-editor/src/nodes/columns-node/columns-node.scss packages/doc-editor/src/templates/simple/doc-editor.tsx
git commit -m "feat(doc-editor): add columns node view with mobile horizontal scroll"
```

### Task 7: 增加 Markdown 降级序列化与回归验证

**Files:**
- Modify: `packages/doc-editor/src/lib/markdown.ts`
- Create: `packages/doc-editor/tests/markdown-columns.test.ts`

**Step 1: Write the failing test**

```ts
test("tiptapJsonToMarkdown degrades columns to sequential blocks", () => {
  const json = {
    type: "doc",
    content: [
      {
        type: "columns",
        attrs: { count: 2 },
        content: [
          { type: "column", content: [{ type: "paragraph", content: [{ type: "text", text: "L" }] }] },
          { type: "column", content: [{ type: "paragraph", content: [{ type: "text", text: "R" }] }] },
        ],
      },
    ],
  };
  const md = tiptapJsonToMarkdown(json as any);
  assert.match(md, /L/);
  assert.match(md, /R/);
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/darin/mine/code/zeus && node --import tsx --test packages/doc-editor/tests/markdown-columns.test.ts`  
Expected: FAIL with unknown node serializer for columns/column.

**Step 3: Write minimal implementation**

```ts
// markdown serializer nodes map
columns: (state, node) => {
  node.forEach((col, _offset, index) => {
    col.forEach((child) => state.render(child, node, index));
    if (index < node.childCount - 1) {
      state.write("\n");
    }
  });
  state.closeBlock(node);
},
column: (state, node) => {
  node.forEach((child) => state.render(child, node, 0));
},
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/darin/mine/code/zeus && node --import tsx --test packages/doc-editor/tests/markdown-columns.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/doc-editor/src/lib/markdown.ts packages/doc-editor/tests/markdown-columns.test.ts
git commit -m "feat(doc-editor): add markdown degrade serializer for columns blocks"
```

### Task 8: 端到端回归与验收

**Files:**
- Create: `output/playwright/doc-columns-regression.js`
- Optional: `output/playwright/doc-columns-regression.png`

**Step 1: Write the failing regression script**

```js
// scenario:
// 1) open editor
// 2) insert 3-column block
// 3) fill each column text
// 4) switch to 5 columns
// 5) verify original content preserved
// 6) set mobile viewport and verify horizontal scroll container exists
```

**Step 2: Run to verify it fails (before final fixes)**

Run: `cd /Users/darin/mine/code/zeus && /bin/zsh -lc 'playwright-cli run-code "$(cat /Users/darin/mine/code/zeus/output/playwright/doc-columns-regression.js)"'`  
Expected: FAIL before all tasks complete.

**Step 3: Run after implementation**

Run: `cd /Users/darin/mine/code/zeus && /bin/zsh -lc 'playwright-cli run-code "$(cat /Users/darin/mine/code/zeus/output/playwright/doc-columns-regression.js)"'`  
Expected: PASS assertions.

**Step 4: Full verification**

Run: `cd /Users/darin/mine/code/zeus && npm run test:unified-editor`  
Expected: PASS with no regressions.

**Step 5: Commit**

```bash
git add output/playwright/doc-columns-regression.js
git commit -m "test(web): add playwright regression for columns block behavior"
```

