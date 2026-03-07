# 文档与块创建副本 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 增加文档级与块级“创建副本”能力：文档副本复制文档本体到同父级并自动命名，块副本复制当前块到下方。

**Architecture:** 文档级副本采用后端 API 驱动，保证命名与持久化一致；块级副本采用编辑器本地变更并复用现有 autosave。前端页面仅做状态层最小同步（树、面包屑、缓存）。测试优先使用纯函数/服务层单测，避免高成本端到端依赖。

**Tech Stack:** TypeScript, Express (app-backend), React, TipTap, Node test runner (`node --import tsx --test`)

---

实施时请全程遵循：@superpowers:test-driven-development、@superpowers:verification-before-completion。

### Task 1: 后端文档副本服务（命名与内容复制）

**Files:**
- Create: `apps/app-backend/src/services/document-duplicate.ts`
- Create: `apps/app-backend/tests/document-duplicate-service.test.ts`
- Modify: `apps/app-backend/src/storage/document-store.ts`（如需补充最小工具导出）

**Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { duplicateDocumentInStore } from "../src/services/document-duplicate.ts";
import { documentStore } from "../src/storage/document-store.ts";

test("duplicateDocumentInStore creates sibling copy with incremented title", async () => {
  // Arrange: root 下已有 "设计文档" 和 "设计文档（副本）"
  // Act: duplicate "设计文档"
  // Assert: 新文档标题为 "设计文档（副本2）"，parent_id 不变，content 深拷贝一致
  assert.equal(true, false);
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/app-backend/tests/document-duplicate-service.test.ts`
Expected: FAIL（`duplicateDocumentInStore` 未实现或断言失败）

**Step 3: Write minimal implementation**

```ts
export async function duplicateDocumentInStore(input: {
  userId: string;
  projectKey: string;
  docId: string;
}) {
  const source = await documentStore.get(input.userId, input.projectKey, input.docId);
  const siblings = await documentStore.getChildren(input.userId, input.projectKey, source.meta.parent_id || "root");
  const nextTitle = resolveDuplicateTitle(source.meta.title, new Set(siblings.map((s) => s.title)));

  return documentStore.save(input.userId, input.projectKey, {
    meta: {
      ...source.meta,
      id: "",
      slug: "",
      title: nextTitle,
      created_at: "",
      updated_at: "",
    },
    body: structuredClone(source.body),
  });
}
```

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test apps/app-backend/tests/document-duplicate-service.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/app-backend/src/services/document-duplicate.ts apps/app-backend/tests/document-duplicate-service.test.ts apps/app-backend/src/storage/document-store.ts
git commit -m "feat: add backend document duplicate service"
```

### Task 2: 后端路由接入文档副本 API

**Files:**
- Modify: `apps/app-backend/src/router.ts`
- Modify: `apps/app-backend/src/services/document-duplicate.ts`（按路由入参细化）

**Step 1: Write the failing test**

Create route-level light test (handler contract) in the existing service test file first:

```ts
test("duplicate route contract uses source doc id and returns created document", async () => {
  // 调用 duplicateDocumentInStore 并断言返回包含新 meta.id / meta.title
  // 先写成当前实现下失败的断言
  assert.equal(true, false);
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/app-backend/tests/document-duplicate-service.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

在 `router.ts` 增加：

```ts
router.post("/projects/:ownerType/:ownerKey/:projectKey/documents/:docId/duplicate", async (req, res) => {
  const { projectKey, docId } = req.params;
  const userId = getUserId(req);
  const duplicated = await duplicateDocumentInStore({ userId, projectKey, docId });
  success(res, { meta: duplicated.meta, body: duplicated.body }, 201);
});
```

并处理：`DocumentNotFoundError -> 404`。

**Step 4: Run tests + quick smoke**

Run:
- `node --import tsx --test apps/app-backend/tests/document-duplicate-service.test.ts`
- `npm run test:unified-editor`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/app-backend/src/router.ts apps/app-backend/src/services/document-duplicate.ts apps/app-backend/tests/document-duplicate-service.test.ts
git commit -m "feat: expose document duplicate api"
```

### Task 3: 前端 API 与文档菜单入口

**Files:**
- Modify: `apps/web/src/api/documents.ts`
- Modify: `apps/web/src/components/DocumentHeader.tsx`
- Modify: `apps/web/src/pages/DocumentPage.tsx`

**Step 1: Write the failing test**

Create: `apps/web/tests/document-duplicate-state.test.ts`

```ts
test("document duplicate inserts new sibling under same parent", () => {
  // 先写断言：新副本文档应出现在同父级 children 列表
  // 当前 helper 不存在应失败
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/web/tests/document-duplicate-state.test.ts`
Expected: FAIL（缺少 helper/行为）

**Step 3: Write minimal implementation**

- API:
```ts
export const duplicateDocument = async (projectKey: string, docId: string) => {
  const response = await apiFetch(`/api/projects/${encodeProjectRef(projectKey)}/documents/${encodeURIComponent(docId)}/duplicate`, { method: "POST" });
  if (!response.ok) throw new Error("duplicate document failed");
  const payload = await response.json();
  return payload?.data;
};
```

- Header 增加 `onDuplicate?: () => void` 与菜单项“创建副本”。
- `DocumentPage` 增加 `handleDuplicateDocument`，调用 API 后局部更新树与缓存。

**Step 4: Run tests to verify pass**

Run:
- `node --import tsx --test apps/web/tests/document-duplicate-state.test.ts`
- `npm run test:unified-editor`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/src/api/documents.ts apps/web/src/components/DocumentHeader.tsx apps/web/src/pages/DocumentPage.tsx apps/web/tests/document-duplicate-state.test.ts
git commit -m "feat: add document duplicate action in header menu"
```

### Task 4: 文档页状态同步辅助函数（树/面包屑/缓存）

**Files:**
- Create: `apps/web/src/features/document-page/duplicate-state.ts`
- Modify: `apps/web/tests/document-duplicate-state.test.ts`
- Modify: `apps/web/src/pages/DocumentPage.tsx`

**Step 1: Write the failing test**

```ts
import { applyDuplicatedDocumentToTree } from "../src/features/document-page/duplicate-state";

test("applyDuplicatedDocumentToTree preserves references when parent not found", () => {
  // 先写严格引用断言，当前未实现会失败
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/web/tests/document-duplicate-state.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

```ts
export function applyDuplicatedDocumentToTree(rootDocs, childrenByParent, duplicated) {
  const parentId = duplicated.parentId || "";
  if (!parentId || parentId === "root") {
    return { rootDocs: [...rootDocs, duplicated], childrenByParent };
  }
  return {
    rootDocs,
    childrenByParent: {
      ...childrenByParent,
      [parentId]: [...(childrenByParent[parentId] || []), duplicated],
    },
  };
}
```

在 `DocumentPage` 中复用 helper，避免手写重复 setState 逻辑。

**Step 4: Run tests to verify pass**

Run:
- `node --import tsx --test apps/web/tests/document-duplicate-state.test.ts`
- `npm run test:unified-editor`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/src/features/document-page/duplicate-state.ts apps/web/tests/document-duplicate-state.test.ts apps/web/src/pages/DocumentPage.tsx
git commit -m "refactor: centralize duplicated document tree state update"
```

### Task 5: 块菜单“创建副本”与复制逻辑

**Files:**
- Create: `packages/doc-editor/src/extensions/block-duplicate.ts`
- Create: `packages/doc-editor/tests/block-duplicate.test.ts`
- Modify: `packages/doc-editor/src/templates/simple/doc-editor.tsx`
- Modify: `packages/doc-editor/src/templates/simple/doc-editor.scss`（如新增菜单项样式）

**Step 1: Write the failing test**

```ts
import { duplicateTopLevelBlockJson } from "../src/extensions/block-duplicate";

test("duplicateTopLevelBlockJson inserts copy right after source block", () => {
  // 输入 doc content + blockId，断言输出顺序与内容
  // 当前函数不存在，测试应失败
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test packages/doc-editor/tests/block-duplicate.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

```ts
export function duplicateTopLevelBlockJson(docJson: JSONContent, blockId: string): JSONContent {
  const blocks = [...(docJson.content || [])];
  const index = blocks.findIndex((item) => item.attrs?.id === blockId);
  if (index < 0) return docJson;
  const cloned = structuredClone(blocks[index]);
  delete (cloned as any).attrs?.id;
  blocks.splice(index + 1, 0, cloned);
  return { ...docJson, content: blocks };
}
```

在 `DocEditor` 块菜单加入“创建副本”项并调用该逻辑，随后 `editor.view.dispatch(...)` 插入。

**Step 4: Run tests to verify pass**

Run:
- `node --import tsx --test packages/doc-editor/tests/block-duplicate.test.ts`
- `npm run test:unified-editor`

Expected: PASS

**Step 5: Commit**

```bash
git add packages/doc-editor/src/extensions/block-duplicate.ts packages/doc-editor/tests/block-duplicate.test.ts packages/doc-editor/src/templates/simple/doc-editor.tsx packages/doc-editor/src/templates/simple/doc-editor.scss
git commit -m "feat: support duplicate current block from block menu"
```

### Task 6: 验证与交付收尾

**Files:**
- Modify: `package.json`（若新增测试入口）
- Modify: `apps/web/tests/*` / `packages/doc-editor/tests/*`（仅必要）

**Step 1: Run full verification**

Run:
- `npm run test:unified-editor`
- `node --import tsx --test apps/app-backend/tests/document-duplicate-service.test.ts`
- `node --import tsx --test apps/web/tests/document-duplicate-state.test.ts`
- `node --import tsx --test packages/doc-editor/tests/block-duplicate.test.ts`

Expected: 全部 PASS

**Step 2: Manual smoke (UI)**

1. 文档菜单点击“创建副本”，检查树同父级出现 `（副本）`。
2. 块菜单点击“创建副本”，检查副本块插入原块后。
3. Undo/Redo 检查块副本行为。

**Step 3: Final commit (if needed)**

```bash
git add package.json apps/app-backend/tests/document-duplicate-service.test.ts apps/web/tests/document-duplicate-state.test.ts packages/doc-editor/tests/block-duplicate.test.ts
git commit -m "test: cover document and block duplicate workflows"
```

**Step 4: PR summary**

总结以下内容：
1. 新增 API 与行为边界（文档本体复制、同父级命名规则）
2. 块级复制语义（仅当前块）
3. 风险与后续扩展点（目录递归复制、语义范围复制）
