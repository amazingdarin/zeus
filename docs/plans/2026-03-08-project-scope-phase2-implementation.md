# Project Scope Phase 2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade the project-scope harness from a directory skeleton into a behavior-level harness, starting with personal owner scope and preparing for team-role expansion.

**Architecture:** Extend the existing `tests/harness/project-scope/` and `tests/fixtures/project-scope/` structure with deterministic personal-scope fixtures, API harnesses, and one frontend round-trip harness. Keep the first phase API-heavy and reusable so team-role coverage can layer on top later.

**Tech Stack:** Go server auth/project APIs, TypeScript app-backend owner-scope routing, React/Vite frontend projectRef handling, Playwright CLI, Node test runner.

---

### Task 1: Add personal-scope fixture contract

**Files:**
- Create: `tests/fixtures/project-scope/personal.json`
- Modify: `tests/fixtures/project-scope/README.md`
- Test: `apps/app-backend/tests/project-scope-fixture-contract.test.ts`

**Step 1: Write the failing test**

Create `apps/app-backend/tests/project-scope-fixture-contract.test.ts` to assert:
- `personal.json` exists
- it contains `ownerType`, `ownerKey`, `projectKey`, `alternateProjectKey`, `invalidOwnerKey`

**Step 2: Run test to verify it fails**

Run: `cd apps/app-backend && node --import tsx --test tests/project-scope-fixture-contract.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Add `tests/fixtures/project-scope/personal.json` with stable personal-scope fixture fields and update the README to explain them.

**Step 4: Run test to verify it passes**

Run: `cd apps/app-backend && node --import tsx --test tests/project-scope-fixture-contract.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add tests/fixtures/project-scope/personal.json tests/fixtures/project-scope/README.md apps/app-backend/tests/project-scope-fixture-contract.test.ts
git commit -m "test: add project scope fixture contract"
```

### Task 2: Add personal-scope API harnesses

**Files:**
- Create: `tests/harness/project-scope/api/personal-valid.mjs`
- Create: `tests/harness/project-scope/api/personal-invalid-owner.mjs`
- Create: `tests/harness/project-scope/api/personal-cross-user-denied.mjs`
- Create: `tests/harness/project-scope/api/project-ref-roundtrip.mjs`
- Modify: `package.json`
- Modify: `Makefile`
- Test: `apps/app-backend/tests/project-scope-harness-manifest.test.ts`

**Step 1: Extend the failing test**

Update `apps/app-backend/tests/project-scope-harness-manifest.test.ts` so it also expects the four new API harness files.

**Step 2: Run test to verify it fails**

Run: `cd apps/app-backend && node --import tsx --test tests/project-scope-harness-manifest.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Implement:
- `personal-valid.mjs`: verify `personal::me::<project>` returns success
- `personal-invalid-owner.mjs`: verify `personal::not-me::<project>` fails with expected failure class
- `personal-cross-user-denied.mjs`: verify explicit non-current-user owner is rejected
- `project-ref-roundtrip.mjs`: verify encoded frontend-style refs map to the expected backend path behavior

Wire a package script such as `eval:project-scope:personal` and include it in `project-scope-eval`.

**Step 4: Run tests and harnesses to verify they pass**

Run:
- `cd apps/app-backend && node --import tsx --test tests/project-scope-harness-manifest.test.ts`
- `cd /Users/darin/mine/code/zeus && npm run eval:project-scope:personal`

Expected: PASS.

**Step 5: Commit**

```bash
git add tests/harness/project-scope/api package.json Makefile apps/app-backend/tests/project-scope-harness-manifest.test.ts
git commit -m "test: add personal project scope harnesses"
```

### Task 3: Add a frontend personal projectRef round-trip harness

**Files:**
- Create: `tests/harness/project-scope/playwright/README.md`
- Create: `tests/harness/project-scope/playwright/personal-project-ref.mjs`
- Create: `apps/web/tests/project-scope-playwright-manifest.test.ts`
- Test: `apps/web/tests/project-scope-playwright-manifest.test.ts`

**Step 1: Write the failing test**

Create `apps/web/tests/project-scope-playwright-manifest.test.ts` to assert the browser harness files exist.

**Step 2: Run test to verify it fails**

Run: `cd apps/web && node --import tsx --test tests/project-scope-playwright-manifest.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Implement one browser harness that:
- seeds or reads the personal project fixture
- writes the corresponding `projectRef`
- opens the app
- confirms a project-scoped request path is consistent with the expected owner/project tuple

**Step 4: Run tests and harness to verify they pass**

Run:
- `cd apps/web && node --import tsx --test tests/project-scope-playwright-manifest.test.ts`
- `cd /Users/darin/mine/code/zeus && node scripts/dev/run-playwright-harness.mjs tests/harness/project-scope/playwright/personal-project-ref.mjs`

Expected: PASS.

**Step 5: Commit**

```bash
git add tests/harness/project-scope/playwright apps/web/tests/project-scope-playwright-manifest.test.ts
git commit -m "test: add project scope playwright harness"
```

### Task 4: Update docs and command index for personal-scope behavior harnesses

**Files:**
- Modify: `docs/evals/project-scope.md`
- Modify: `docs/architecture/project-scope.md`
- Modify: `docs/evals/README.md`
- Test: `tests/project-scope-doc-links.test.mjs`

**Step 1: Write the failing test**

Create `tests/project-scope-doc-links.test.mjs` to assert the project-scope docs mention:
- personal owner scope
- `eval:project-scope:personal`
- browser round-trip coverage

**Step 2: Run test to verify it fails**

Run: `node --test tests/project-scope-doc-links.test.mjs`
Expected: FAIL.

**Step 3: Write minimal implementation**

Update docs to explain:
- the personal fixture
- the new API harnesses
- the new browser harness
- how later team-role matrix work will build on them

**Step 4: Run test to verify it passes**

Run: `node --test tests/project-scope-doc-links.test.mjs`
Expected: PASS.

**Step 5: Commit**

```bash
git add docs/evals/project-scope.md docs/architecture/project-scope.md docs/evals/README.md tests/project-scope-doc-links.test.mjs
git commit -m "docs: expand project scope harness docs"
```

### Task 5: Run the personal-scope validation bundle

**Files:**
- Modify: `docs/evals/project-scope.md`

**Step 1: Run validation**

Run:

```bash
cd apps/app-backend && node --import tsx --test tests/project-scope-fixture-contract.test.ts tests/project-scope-harness-manifest.test.ts
cd ../web && node --import tsx --test tests/project-scope-playwright-manifest.test.ts
cd ../.. && npm run eval:project-scope:api && npm run eval:project-scope:personal
```

Expected: all personal-scope harness checks pass.

**Step 2: Update doc with exact validation sequence**

Record the final command sequence in `docs/evals/project-scope.md`.

**Step 3: Commit**

```bash
git add docs/evals/project-scope.md
git commit -m "test: validate personal project scope harness"
```
