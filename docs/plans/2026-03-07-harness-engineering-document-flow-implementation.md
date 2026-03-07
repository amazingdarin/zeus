# Harness Engineering Document Flow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Phase 1 internal harness-engineering pilot for the Zeus document flow so document-domain changes become reproducible, seedable, and regression-tested.

**Architecture:** Add a dedicated document-flow harness layer around the existing `server`, `apps/app-backend`, and `apps/web` stacks, then refactor only the highest-friction document modules behind that harness. The environment layer, fixtures, and named regression entrypoints come first; structural refactors come after stable validation exists.

**Tech Stack:** Go server, TypeScript app-backend, React/Vite web, Playwright CLI, Node test runner, PostgreSQL, existing Zeus fixture data.

---

### Task 1: Create the document-flow harness directory and docs shell

**Files:**
- Create: `tests/harness/document-flow/README.md`
- Create: `tests/harness/document-flow/playwright/README.md`
- Create: `tests/harness/document-flow/api/README.md`
- Create: `tests/fixtures/document-flow/README.md`
- Create: `docs/architecture/document-flow.md`
- Create: `docs/evals/document-flow.md`

**Step 1: Write the failing test**

Create `apps/web/tests/document-flow-harness-docs.test.ts` with a test that checks these files exist and contain the phrases `document flow`, `seed`, and `regression`.

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const files = [
  "../../tests/harness/document-flow/README.md",
  "../../tests/fixtures/document-flow/README.md",
  "../../docs/architecture/document-flow.md",
  "../../docs/evals/document-flow.md",
];

test("document-flow harness docs exist", () => {
  for (const file of files) {
    const text = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(text.toLowerCase(), /document flow|seed|regression/);
  }
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/web && node --import tsx --test tests/document-flow-harness-docs.test.ts`
Expected: FAIL because the files do not exist yet.

**Step 3: Write minimal implementation**

Create the six markdown files listed above with short but real content:
- architecture doc explaining the document-flow data path
- eval doc listing required harnesses
- harness READMEs explaining placement and ownership
- fixture README documenting seeded entities

**Step 4: Run test to verify it passes**

Run: `cd apps/web && node --import tsx --test tests/document-flow-harness-docs.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/tests/document-flow-harness-docs.test.ts tests/harness/document-flow tests/fixtures/document-flow docs/architecture/document-flow.md docs/evals/document-flow.md
git commit -m "docs: add document flow harness docs"
```

### Task 2: Add a local document-flow doctor command

**Files:**
- Create: `scripts/dev/document-flow-doctor.mjs`
- Modify: `package.json`
- Modify: `AGENTS.md`
- Test: `tests/i18n-build.test.mjs`

**Step 1: Write the failing test**

Add a test to `tests/i18n-build.test.mjs` or create `tests/document-flow-doctor.test.mjs` that runs `node scripts/dev/document-flow-doctor.mjs --json` and expects keys for `server`, `appBackend`, `web`, `postgres`, and `testAccount`.

```js
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

test("document-flow doctor prints required checks", () => {
  const output = execFileSync("node", ["scripts/dev/document-flow-doctor.mjs", "--json"], { encoding: "utf8" });
  const row = JSON.parse(output);
  for (const key of ["server", "appBackend", "web", "postgres", "testAccount"]) {
    assert.ok(key in row);
  }
});
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/document-flow-doctor.test.mjs`
Expected: FAIL because the script does not exist.

**Step 3: Write minimal implementation**

Implement `scripts/dev/document-flow-doctor.mjs` to check:
- `server` on `:8080`
- `app-backend` on `:4870`
- `web` on `:1420`
- `output/playwright/test-account.json` exists
- `server` and `app-backend` both respond on document-flow endpoints

Add a root package script such as `"doctor:doc-flow": "node scripts/dev/document-flow-doctor.mjs"`.

Update `AGENTS.md` with the new command under frontend/document-flow verification guidance.

**Step 4: Run test to verify it passes**

Run: `node --test tests/document-flow-doctor.test.mjs`
Expected: PASS.

**Step 5: Commit**

```bash
git add scripts/dev/document-flow-doctor.mjs package.json AGENTS.md tests/document-flow-doctor.test.mjs
git commit -m "chore: add document flow doctor"
```

### Task 3: Add deterministic document-flow seed and reset scripts

**Files:**
- Create: `scripts/dev/document-flow-seed.mjs`
- Create: `scripts/dev/document-flow-reset.mjs`
- Create: `tests/fixtures/document-flow/project.json`
- Create: `tests/fixtures/document-flow/documents/*.json`
- Modify: `package.json`
- Test: `apps/app-backend/tests/document-flow-seed-contract.test.ts`

**Step 1: Write the failing test**

Create `apps/app-backend/tests/document-flow-seed-contract.test.ts` to assert the fixture directory contains:
- one project fixture
- at least three document fixtures
- one locked document fixture
- one comment fixture or comment-bearing document fixture

**Step 2: Run test to verify it fails**

Run: `cd apps/app-backend && node --import tsx --test tests/document-flow-seed-contract.test.ts`
Expected: FAIL because fixtures and scripts are missing.

**Step 3: Write minimal implementation**

Add:
- `tests/fixtures/document-flow/project.json`
- `tests/fixtures/document-flow/documents/root.json`
- `tests/fixtures/document-flow/documents/locked.json`
- `tests/fixtures/document-flow/documents/commented.json`

Implement seed/reset scripts that use the existing APIs or direct DB/storage services to ensure the test project and documents exist.

Add package scripts:
- `seed:doc-flow`
- `reset:doc-flow`

**Step 4: Run test to verify it passes**

Run: `cd apps/app-backend && node --import tsx --test tests/document-flow-seed-contract.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add scripts/dev/document-flow-seed.mjs scripts/dev/document-flow-reset.mjs tests/fixtures/document-flow package.json apps/app-backend/tests/document-flow-seed-contract.test.ts
git commit -m "test: add document flow seed fixtures"
```

### Task 4: Promote existing document Playwright scripts into a stable harness

**Files:**
- Create: `tests/harness/document-flow/playwright/smoke-login-documents.js`
- Create: `tests/harness/document-flow/playwright/title-sync.js`
- Create: `tests/harness/document-flow/playwright/tabs-restore.js`
- Create: `tests/harness/document-flow/playwright/comments.js`
- Create: `tests/harness/document-flow/playwright/lock.js`
- Create: `tests/harness/document-flow/playwright/i18n.js`
- Create: `tests/harness/document-flow/playwright/ppt-context.js`
- Create: `tests/harness/document-flow/playwright/_helpers/account.js`
- Modify: `package.json`
- Test: `apps/web/tests/document-flow-playwright-manifest.test.ts`

**Step 1: Write the failing test**

Create `apps/web/tests/document-flow-playwright-manifest.test.ts` that asserts the seven stable harness scripts exist and `_helpers/account.js` exists.

**Step 2: Run test to verify it fails**

Run: `cd apps/web && node --import tsx --test tests/document-flow-playwright-manifest.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Move or adapt the existing stable scripts from `output/playwright/` into `tests/harness/document-flow/playwright/`, using shared helper code for the test account and base URL.

Add package scripts such as:
- `eval:doc-flow:smoke`
- `eval:doc-flow:i18n`
- `eval:doc-flow:comments`

Each harness should write artifacts under `output/harness/document-flow/<name>/`.

**Step 4: Run test to verify it passes**

Run: `cd apps/web && node --import tsx --test tests/document-flow-playwright-manifest.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add tests/harness/document-flow/playwright apps/web/tests/document-flow-playwright-manifest.test.ts package.json
git commit -m "test: add document flow playwright harness"
```

### Task 5: Add a document-flow API smoke harness

**Files:**
- Create: `tests/harness/document-flow/api/smoke.mjs`
- Create: `tests/harness/document-flow/api/comments.mjs`
- Create: `tests/harness/document-flow/api/lock.mjs`
- Create: `tests/harness/document-flow/api/_helpers/auth.mjs`
- Modify: `package.json`
- Test: `apps/app-backend/tests/document-flow-api-harness.test.ts`

**Step 1: Write the failing test**

Create a test that checks the API harness entrypoint files exist and export executable Node scripts.

**Step 2: Run test to verify it fails**

Run: `cd apps/app-backend && node --import tsx --test tests/document-flow-api-harness.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Implement API smoke scripts for:
- auth + project resolution
- document tree fetch
- document read
- comment create/reply/status update/delete
- lock/unlock

Use the seeded project and the test account from `output/playwright/test-account.json`.

**Step 4: Run test to verify it passes**

Run: `cd apps/app-backend && node --import tsx --test tests/document-flow-api-harness.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add tests/harness/document-flow/api apps/app-backend/tests/document-flow-api-harness.test.ts package.json
git commit -m "test: add document flow api harness"
```

### Task 6: Split document-page orchestration from page rendering

**Files:**
- Create: `apps/web/src/features/document-page/document-flow-orchestrator.ts`
- Create: `apps/web/src/features/document-page/document-flow-selectors.ts`
- Modify: `apps/web/src/pages/DocumentPage.tsx`
- Modify: `apps/web/src/components/KnowledgeBaseSideNav.tsx`
- Test: `apps/web/tests/document-page-orchestrator.test.ts`
- Test: `apps/web/tests/document-title-sync.test.ts`
- Test: `apps/web/tests/document-page-comment-context.test.ts`

**Step 1: Write the failing test**

Add `apps/web/tests/document-page-orchestrator.test.ts` that verifies derived page state can be computed without rendering the whole page component.

Example assertions:
- active doc metadata selection
- tab title derivation
- tree visibility logic
- empty-project draft mode logic pass-through

**Step 2: Run test to verify it fails**

Run: `cd apps/web && node --import tsx --test tests/document-page-orchestrator.test.ts`
Expected: FAIL because the orchestrator module does not exist.

**Step 3: Write minimal implementation**

Move pure derivation logic out of `DocumentPage.tsx` into `document-flow-orchestrator.ts` and `document-flow-selectors.ts`.

Keep side effects in `DocumentPage.tsx`, but remove low-level derived-state branching that can live in plain functions.

**Step 4: Run tests to verify they pass**

Run:
- `cd apps/web && node --import tsx --test tests/document-page-orchestrator.test.ts`
- `cd apps/web && node --import tsx --test tests/document-title-sync.test.ts tests/document-page-comment-context.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/features/document-page/document-flow-orchestrator.ts apps/web/src/features/document-page/document-flow-selectors.ts apps/web/src/pages/DocumentPage.tsx apps/web/src/components/KnowledgeBaseSideNav.tsx apps/web/tests/document-page-orchestrator.test.ts
git commit -m "refactor: extract document flow orchestration"
```

### Task 7: Split document-domain backend routes out of the monolithic router

**Files:**
- Create: `apps/app-backend/src/router/documents.ts`
- Create: `apps/app-backend/src/router/document-comments.ts`
- Create: `apps/app-backend/src/router/document-lock.ts`
- Modify: `apps/app-backend/src/router.ts`
- Test: `apps/app-backend/tests/document-router-split.test.ts`

**Step 1: Write the failing test**

Create `apps/app-backend/tests/document-router-split.test.ts` that imports the new route modules and asserts they register expected route groups without importing the full monolithic router implementation.

**Step 2: Run test to verify it fails**

Run: `cd apps/app-backend && node --import tsx --test tests/document-router-split.test.ts`
Expected: FAIL because the new route modules do not exist.

**Step 3: Write minimal implementation**

Extract route-registration helpers for:
- document CRUD/tree/hierarchy
- block comments
- lock/unlock

Keep current API paths unchanged. `router.ts` should become a composition layer rather than the implementation home for all document routes.

**Step 4: Run test to verify it passes**

Run: `cd apps/app-backend && node --import tsx --test tests/document-router-split.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/app-backend/src/router apps/app-backend/tests/document-router-split.test.ts
git commit -m "refactor: split document routes from app router"
```

### Task 8: Add one-command document-flow regression execution

**Files:**
- Modify: `package.json`
- Modify: `Makefile`
- Modify: `docs/evals/document-flow.md`
- Test: `tests/document-flow-command-contract.test.mjs`

**Step 1: Write the failing test**

Create `tests/document-flow-command-contract.test.mjs` that reads `package.json` and `Makefile` and verifies the presence of command entrypoints:
- `doctor:doc-flow`
- `seed:doc-flow`
- `reset:doc-flow`
- `eval:doc-flow:smoke`
- `eval:doc-flow:api`

**Step 2: Run test to verify it fails**

Run: `node --test tests/document-flow-command-contract.test.mjs`
Expected: FAIL if any command is missing.

**Step 3: Write minimal implementation**

Wire package scripts and `Makefile` targets so a developer can run:

```bash
make doc-flow-doctor
make doc-flow-seed
make doc-flow-eval
```

Document exact usage and artifact locations in `docs/evals/document-flow.md`.

**Step 4: Run test to verify it passes**

Run: `node --test tests/document-flow-command-contract.test.mjs`
Expected: PASS.

**Step 5: Commit**

```bash
git add package.json Makefile docs/evals/document-flow.md tests/document-flow-command-contract.test.mjs
git commit -m "chore: add document flow command entrypoints"
```

### Task 9: Run the full Phase 1 validation pass

**Files:**
- Modify: `docs/evals/document-flow.md`
- Create: `output/harness/document-flow/.gitkeep`

**Step 1: Write the failing test**

No new unit test. The failing condition is the absence of a full documented validation checklist.

**Step 2: Run validation commands before final cleanup**

Run:

```bash
npm run i18n:build
cd apps/app-backend && node --import tsx --test tests/document-flow-seed-contract.test.ts tests/document-flow-api-harness.test.ts tests/document-router-split.test.ts tests/document-block-comment-http.test.ts tests/document-lock-service.test.ts && npm run build
cd ../web && node --import tsx --test tests/document-flow-harness-docs.test.ts tests/document-flow-playwright-manifest.test.ts tests/document-page-orchestrator.test.ts tests/project-ref-storage.test.ts tests/document-title-sync.test.ts && npm run build
cd ../.. && make doc-flow-eval
```

Expected: all targeted tests pass and the document-flow harness produces artifacts in `output/harness/document-flow/`.

**Step 3: Update documentation**

Document the exact validation command sequence and expected artifact directories in `docs/evals/document-flow.md`.

**Step 4: Commit**

```bash
git add docs/evals/document-flow.md output/harness/document-flow/.gitkeep
git commit -m "test: validate document flow harness"
```
