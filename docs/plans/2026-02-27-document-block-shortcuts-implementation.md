# Document Block Shortcuts Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add configurable single-character block shortcuts so users can select blocks from slash menu by key (for example `1`) and directly insert blocks by typing `/1`.

**Architecture:** Extend the existing slash menu keyboard loop in `DocEditor` and keep insertion logic centralized in `insertBuiltinBlock`. Persist per-user shortcut config in general settings (`/api/settings/general`), expose it to web settings UI, and inject resolved mappings into `DocEditor` at runtime.

**Tech Stack:** TypeScript, React, Tiptap, Express, PostgreSQL JSONB, node:test + assert.

---

### Task 1: Add Shortcut Schema and Resolver Utilities (doc-editor)

**Files:**
- Create: `packages/doc-editor/src/extensions/block-shortcuts.ts`
- Modify: `packages/doc-editor/src/extensions/block-add-handle.ts`
- Modify: `packages/doc-editor/src/ui/block-add-menu.tsx`
- Test: `packages/doc-editor/tests/block-shortcut.test.ts`

**Step 1: Write the failing test**

Add `packages/doc-editor/tests/block-shortcut.test.ts` to cover:
1. default shortcut map generation
2. sanitize invalid map entries (invalid key/value)
3. detect duplicate values (same block bound by two keys)
4. build `keyToBlockMap` and `blockToKeyMap`

Example:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveDocumentBlockShortcuts } from "../src/extensions/block-shortcuts";

test("resolveDocumentBlockShortcuts returns defaults when input is empty", () => {
  const resolved = resolveDocumentBlockShortcuts(undefined);
  assert.equal(resolved.keyToBlockMap["1"], "heading-1");
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test packages/doc-editor/tests/block-shortcut.test.ts`  
Expected: FAIL because resolver module does not exist.

**Step 3: Write minimal implementation**

1. Implement `DocumentBlockShortcuts` types and defaults in `block-shortcuts.ts`.
2. Implement `resolveDocumentBlockShortcuts(input)` with validation and sanitize fallback.
3. Export helper types/functions for menu rendering and key handling.
4. Extend `BuiltinBlockItem` to optionally carry `shortcut`.

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test packages/doc-editor/tests/block-shortcut.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/doc-editor/src/extensions/block-shortcuts.ts packages/doc-editor/src/extensions/block-add-handle.ts packages/doc-editor/src/ui/block-add-menu.tsx packages/doc-editor/tests/block-shortcut.test.ts
git commit -m "feat(doc-editor): add block shortcut resolver and menu metadata"
```

### Task 2: Implement Slash Shortcut Key Handling in DocEditor

**Files:**
- Modify: `packages/doc-editor/src/templates/simple/doc-editor.tsx`
- Modify: `packages/doc-editor/src/ui/block-add-menu.tsx`
- Modify: `packages/doc-editor/src/templates/simple/doc-editor.scss`
- Test: `packages/doc-editor/tests/block-shortcut.test.ts`

**Step 1: Write the failing test**

Extend tests for:
1. when slash menu is open, pressing mapped key selects mapped block
2. unmatched key does not select
3. `isComposing=true` bypasses shortcut handling

Add pure-function tests first (extract handler if needed).

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test packages/doc-editor/tests/block-shortcut.test.ts`  
Expected: FAIL on new cases.

**Step 3: Write minimal implementation**

1. Add `documentBlockShortcuts` prop to `DocEditorProps`.
2. Resolve runtime map with `resolveDocumentBlockShortcuts`.
3. In existing keydown loop:
   - if slash menu is open and key is mapped, call `selectBuiltinBlockFromMenu(mappedType, "slash")`
   - keep arrow/enter/esc logic unchanged
4. In menu UI, show shortcut label on each item.

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test packages/doc-editor/tests/block-shortcut.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/doc-editor/src/templates/simple/doc-editor.tsx packages/doc-editor/src/ui/block-add-menu.tsx packages/doc-editor/src/templates/simple/doc-editor.scss packages/doc-editor/tests/block-shortcut.test.ts
git commit -m "feat(doc-editor): support slash menu key shortcuts"
```

### Task 3: Implement Direct `/x` Inline Insertion Flow

**Files:**
- Modify: `packages/doc-editor/src/templates/simple/doc-editor.tsx`
- Test: `packages/doc-editor/tests/block-shortcut.test.ts`

**Step 1: Write the failing test**

Add tests for parser helpers:
1. detect `/1` from cursor context
2. convert matched token to mapped block type
3. no trigger for invalid or unmapped tokens

Use pure helper extraction to keep tests deterministic.

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test packages/doc-editor/tests/block-shortcut.test.ts`  
Expected: FAIL on new `/x` parser tests.

**Step 3: Write minimal implementation**

1. Add helper in `doc-editor.tsx` (or reusable module) to inspect cursor-adjacent `"/" + key`.
2. In `editor.on("update", handleUpdate)`:
   - skip when composing
   - if token matched, delete token and insert mapped block in one transaction
   - clear slash menu state
   - add idempotence guard to prevent duplicate trigger per update cycle
3. Keep undo behavior native (single undo reverts insertion).

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test packages/doc-editor/tests/block-shortcut.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/doc-editor/src/templates/simple/doc-editor.tsx packages/doc-editor/tests/block-shortcut.test.ts
git commit -m "feat(doc-editor): support inline slash token insertion"
```

### Task 4: Extend Backend General Settings for Shortcut Persistence

**Files:**
- Create: `ddl/sql/migrations/009_add_document_block_shortcuts.sql`
- Modify: `apps/app-backend/src/services/general-settings-store.ts`
- Modify: `apps/app-backend/src/router.ts`
- Modify: `apps/app-backend/tests/general-settings-store.test.ts`
- Create: `apps/app-backend/tests/general-settings-shortcuts-validation.test.ts`

**Step 1: Write the failing test**

Add backend tests for:
1. store can read/write `documentBlockShortcuts`
2. invalid shortcut payload rejected by validation
3. missing field falls back to defaults

**Step 2: Run test to verify it fails**

Run:

```bash
cd apps/app-backend && node --import tsx --test tests/general-settings-store.test.ts tests/general-settings-shortcuts-validation.test.ts
```

Expected: FAIL because new field/validation is missing.

**Step 3: Write minimal implementation**

1. Add migration with JSONB column default.
2. Extend store types:
   - `GeneralSettings.documentBlockShortcuts`
   - `GeneralSettingsInput.documentBlockShortcuts`
3. Add normalize/validate helper in backend service layer.
4. Extend GET/PUT `/settings/general` to return/accept `document_block_shortcuts`.
5. Return structured `400` on invalid payload.

**Step 4: Run test to verify it passes**

Run:

```bash
cd apps/app-backend && node --import tsx --test tests/general-settings-store.test.ts tests/general-settings-shortcuts-validation.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add ddl/sql/migrations/009_add_document_block_shortcuts.sql apps/app-backend/src/services/general-settings-store.ts apps/app-backend/src/router.ts apps/app-backend/tests/general-settings-store.test.ts apps/app-backend/tests/general-settings-shortcuts-validation.test.ts
git commit -m "feat(settings): persist and validate document block shortcuts"
```

### Task 5: Add Web Settings UI and API Contract for Shortcuts

**Files:**
- Modify: `apps/web/src/api/general-settings.ts`
- Modify: `apps/web/src/components/GeneralSettingsPanel.tsx`
- Create: `apps/web/src/constants/document-block-shortcuts.ts`
- Create: `apps/web/tests/general-settings-shortcuts.test.ts`

**Step 1: Write the failing test**

Add UI-level tests (or pure-validator tests) for:
1. one-char validation
2. duplicate shortcut rejection
3. normalize payload shape for save
4. reset-to-default behavior

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/web/tests/general-settings-shortcuts.test.ts`  
Expected: FAIL because validators/defaults are missing.

**Step 3: Write minimal implementation**

1. Extend `GeneralSettings` / `GeneralSettingsInput` with `documentBlockShortcuts`.
2. Add default shortcut constant and validator helper.
3. Add editable shortcut rows in `GeneralSettingsPanel`.
4. Wire save payload to include `document_block_shortcuts`.
5. Keep unauthenticated save disabled.

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test apps/web/tests/general-settings-shortcuts.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/api/general-settings.ts apps/web/src/components/GeneralSettingsPanel.tsx apps/web/src/constants/document-block-shortcuts.ts apps/web/tests/general-settings-shortcuts.test.ts
git commit -m "feat(web): add configurable block shortcuts in general settings"
```

### Task 6: Inject Settings into Editor and Complete End-to-End Verification

**Files:**
- Modify: `apps/web/src/components/RichTextEditor.tsx`
- Modify: `apps/web/src/pages/DocumentPage.tsx` (if current data flow requires page-level injection)
- Modify: `packages/doc-editor/src/templates/simple/doc-editor.tsx`
- Test: `packages/doc-editor/tests/block-shortcut.test.ts`
- Test: `apps/web/tests/general-settings-shortcuts.test.ts`
- Test: `apps/app-backend/tests/general-settings-store.test.ts`

**Step 1: Write the failing integration check**

Define acceptance checks:
1. settings save updates shortcut map
2. editor receives updated map
3. `/` + key selection works
4. `/x` direct insertion works

**Step 2: Run verification to show current integration gap**

Run:

```bash
node --import tsx --test packages/doc-editor/tests/block-shortcut.test.ts apps/web/tests/general-settings-shortcuts.test.ts apps/app-backend/tests/general-settings-store.test.ts
```

Expected: FAIL before integration wiring is complete.

**Step 3: Write minimal implementation**

1. Fetch general settings where editor is composed.
2. Pass `documentBlockShortcuts` into `DocEditor`.
3. Ensure runtime updates do not recreate editor unnecessarily.
4. Keep backward compatibility when settings are missing.

**Step 4: Run verification to verify pass**

Run:

```bash
node --import tsx --test packages/doc-editor/tests/block-shortcut.test.ts apps/web/tests/general-settings-shortcuts.test.ts
cd apps/app-backend && node --import tsx --test tests/general-settings-store.test.ts tests/general-settings-shortcuts-validation.test.ts
cd /Users/darin/mine/code/zeus && npm run test:unified-editor
```

Expected: PASS.

**Step 5: Build smoke checks**

Run:

```bash
cd apps/web && npm run build
cd /Users/darin/mine/code/zeus/apps/app-backend && npm run build
```

Expected: both builds PASS.

**Step 6: Commit**

```bash
git add apps/web/src/components/RichTextEditor.tsx apps/web/src/pages/DocumentPage.tsx packages/doc-editor/src/templates/simple/doc-editor.tsx packages/doc-editor/tests/block-shortcut.test.ts apps/web/tests/general-settings-shortcuts.test.ts apps/app-backend/tests/general-settings-store.test.ts apps/app-backend/tests/general-settings-shortcuts-validation.test.ts
git commit -m "feat: deliver configurable slash block shortcuts end-to-end"
```
