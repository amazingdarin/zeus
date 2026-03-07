# Word Export Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `Word (.docx)` export for the current document from the existing export dialog, with high-fidelity support for common blocks (heading/paragraph/list/table/code/image/quote).

**Architecture:** Implement a backend docx export pipeline in `apps/app-backend` that reads stored Tiptap JSON and maps it into a `.docx` buffer, then expose it via a new project-scoped API endpoint. Keep frontend changes minimal by extending the existing export modal and calling a new API client helper that downloads blob content.

**Tech Stack:** TypeScript (Node ESM), `docx` npm library, existing `documentStore` + `assetStore`, React + Vite frontend, node:test + assert.

---

### Task 1: Build Block Mapper Baseline (Heading/Paragraph/List)

**Files:**
- Create: `apps/app-backend/src/services/export-docx-mapper.ts`
- Test: `apps/app-backend/tests/export-docx-mapper.test.ts`

**Step 1: Write the failing test**

Add tests that verify:
1. heading level mapping (`heading` -> `HeadingLevel.HEADING_X`)
2. paragraph text + inline marks (`bold`, `italic`, `link`)
3. bullet/ordered list nesting level mapping

Example test scaffold:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { mapTiptapToDocxBlocks } from "../src/services/export-docx-mapper.ts";

test("maps heading/paragraph/list into docx paragraph blocks", async () => {
  const tiptap = { type: "doc", content: [/* fixture */] };
  const blocks = await mapTiptapToDocxBlocks(tiptap, { resolveImage: async () => null });
  assert.ok(blocks.length > 0);
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/app-backend && node --import tsx --test tests/export-docx-mapper.test.ts`  
Expected: FAIL because mapper module does not exist.

**Step 3: Write minimal implementation**

Implement:
1. `mapTiptapToDocxBlocks(...)` entry function
2. `mapParagraphNode`, `mapHeadingNode`, `mapListNode`
3. inline run mapping for text marks (`bold`, `italic`, `underline`, `link`)

**Step 4: Run test to verify it passes**

Run: `cd apps/app-backend && node --import tsx --test tests/export-docx-mapper.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/app-backend/src/services/export-docx-mapper.ts apps/app-backend/tests/export-docx-mapper.test.ts
git commit -m "feat: add baseline tiptap-to-docx mapper"
```

### Task 2: Extend Mapper for Table/Code/Quote/HR and Unknown-Node Fallback

**Files:**
- Modify: `apps/app-backend/src/services/export-docx-mapper.ts`
- Modify: `apps/app-backend/tests/export-docx-mapper.test.ts`

**Step 1: Write the failing test**

Add test cases for:
1. table -> docx table rows/cells
2. codeBlock -> monospaced paragraph style
3. blockquote/horizontalRule style mapping
4. unsupported node -> readable fallback paragraph

**Step 2: Run test to verify it fails**

Run: `cd apps/app-backend && node --import tsx --test tests/export-docx-mapper.test.ts`  
Expected: FAIL on new cases.

**Step 3: Write minimal implementation**

Implement additional node handlers:
1. `table/tableRow/tableCell/tableHeader`
2. `codeBlock`, `blockquote`, `horizontalRule`
3. `fallbackUnsupportedNode(node)` with node type annotation text

**Step 4: Run test to verify it passes**

Run: `cd apps/app-backend && node --import tsx --test tests/export-docx-mapper.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/app-backend/src/services/export-docx-mapper.ts apps/app-backend/tests/export-docx-mapper.test.ts
git commit -m "feat: support table code quote and fallback in docx mapper"
```

### Task 3: Implement Export Service and Image Embedding

**Files:**
- Modify: `apps/app-backend/package.json`
- Create: `apps/app-backend/src/services/export-docx.ts`
- Create: `apps/app-backend/tests/export-docx-service.test.ts`

**Step 1: Write the failing test**

Create service-level tests for:
1. returns non-empty `.docx` buffer for basic document
2. image node tries asset resolution and embeds bytes
3. image resolution failure falls back to URL text paragraph
4. empty/invalid document throws typed error

Example service contract:

```ts
const result = await exportDocumentToDocxBuffer({
  userId: "u1",
  projectKey: "personal::u1::demo",
  docId: "doc-1",
});
assert.ok(result.buffer.length > 0);
assert.equal(result.filename.endsWith(".docx"), true);
```

**Step 2: Run test to verify it fails**

Run: `cd apps/app-backend && node --import tsx --test tests/export-docx-service.test.ts`  
Expected: FAIL because service does not exist.

**Step 3: Write minimal implementation**

1. Add dependency:
   - `docx` in `apps/app-backend/package.json`
2. Implement `exportDocumentToDocxBuffer(...)`:
   - load document via `documentStore.get(userId, projectKey, docId)`
   - map content via `mapTiptapToDocxBlocks`
   - for image URL containing asset id, resolve through `assetStore.getContent(...)`
   - build document and `Packer.toBuffer(...)`
3. Return `{ buffer, filename, contentType }`

**Step 4: Run test to verify it passes**

Run: `cd apps/app-backend && node --import tsx --test tests/export-docx-service.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/app-backend/package.json apps/app-backend/src/services/export-docx.ts apps/app-backend/tests/export-docx-service.test.ts
git commit -m "feat: add docx export service with image embedding fallback"
```

### Task 4: Add Backend Endpoint for Docx Export

**Files:**
- Modify: `apps/app-backend/src/router.ts`
- Create: `apps/app-backend/tests/export-docx-endpoint.test.ts`

**Step 1: Write the failing test**

Add endpoint tests for:
1. `POST /api/projects/:ownerType/:ownerKey/:projectKey/documents/:docId/export-docx` returns `200`
2. response headers include correct content type and attachment filename
3. not-found document returns `404`

Test setup can start a lightweight express app with `buildRouter()`.

**Step 2: Run test to verify it fails**

Run: `cd apps/app-backend && node --import tsx --test tests/export-docx-endpoint.test.ts`  
Expected: FAIL because route is missing.

**Step 3: Write minimal implementation**

1. Register new route in `router.ts` (project-scoped path)
2. Call `exportDocumentToDocxBuffer(...)`
3. Set headers:
   - `Content-Type`
   - `Content-Disposition`
4. Return binary buffer

**Step 4: Run test to verify it passes**

Run: `cd apps/app-backend && node --import tsx --test tests/export-docx-endpoint.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/app-backend/src/router.ts apps/app-backend/tests/export-docx-endpoint.test.ts
git commit -m "feat: expose project-scoped docx export endpoint"
```

### Task 5: Wire Frontend Export Modal to Word API

**Files:**
- Modify: `apps/web/src/api/documents.ts`
- Modify: `apps/web/src/pages/DocumentPage.tsx`
- Modify: `apps/web/src/App.css` (only if UI state style is needed)

**Step 1: Write the failing test (behavioral checklist)**

Define acceptance checklist before coding:
1. export dialog has `Word (.docx)` option
2. selecting Word triggers backend endpoint call
3. browser download filename ends with `.docx`

**Step 2: Run verification to confirm current state fails checklist**

Run: manual check in current UI (Word option absent / no docx request path).  
Expected: checklist fails.

**Step 3: Write minimal implementation**

1. Extend `ExportFormat` union with `"word"`
2. Add `exportDocumentDocx(projectKey, docId)` API helper in `documents.ts`
3. In `handleExportSubmit`, route `"word"` to blob download
4. Keep existing markdown/zeus branches unchanged

**Step 4: Run verification**

Run:
```bash
cd apps/web && npm run build
```
Expected: build PASS.

Then manual smoke:
1. 打开文档页 -> 导出 -> 选择 Word  
2. 点击导出后下载 `.docx`  
3. Word 打开文件可见标题/列表/表格/代码/图片

**Step 5: Commit**

```bash
git add apps/web/src/api/documents.ts apps/web/src/pages/DocumentPage.tsx apps/web/src/App.css
git commit -m "feat(web): add word option in document export modal"
```

### Task 6: Final Verification Sweep

**Files:**
- Test: `apps/app-backend/tests/export-docx-mapper.test.ts`
- Test: `apps/app-backend/tests/export-docx-service.test.ts`
- Test: `apps/app-backend/tests/export-docx-endpoint.test.ts`
- Modify (if needed): `docs/plans/2026-02-27-word-export-design.md`

**Step 1: Run focused backend suite**

Run:
```bash
cd apps/app-backend && node --import tsx --test \
  tests/export-docx-mapper.test.ts \
  tests/export-docx-service.test.ts \
  tests/export-docx-endpoint.test.ts
```
Expected: all PASS.

**Step 2: Run frontend build**

Run:
```bash
cd apps/web && npm run build
```
Expected: PASS.

**Step 3: Manual fidelity check**

Use one real document containing:
- headings
- nested lists
- table
- code block
- image

Expected: Word 打开后结构可读，未知块有可读降级文本。

**Step 4: Commit**

```bash
git add apps/app-backend apps/web docs/plans/2026-02-27-word-export-design.md
git commit -m "feat: deliver high-fidelity docx export for current document"
```

