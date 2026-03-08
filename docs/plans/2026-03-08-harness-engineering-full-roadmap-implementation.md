# Harness Engineering Full Roadmap Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Convert Zeus into a full harness-engineering, agent-first internal engineering system across all core domains.

**Architecture:** Extend the existing document-flow pilot into a repository-wide pattern with domain-specific harnesses, structured knowledge layers, mechanical architectural checks, isolated worktree runtimes, and agent-optimized review/merge flows. The implementation is phased so that each later phase builds on validated harnesses and docs from earlier phases.

**Tech Stack:** Go server, TypeScript app-backend, React/Vite web, Playwright CLI, Node test runner, PostgreSQL, git worktrees, CI scripts, repository-local documentation.

---

### Task 1: Compress root guidance into a navigation layer

**Files:**
- Modify: `AGENTS.md`
- Create: `docs/architecture/README.md`
- Create: `docs/evals/README.md`
- Test: `tests/root-agents-navigation.test.mjs`

**Step 1: Write the failing test**

Create `tests/root-agents-navigation.test.mjs` to assert:
- `AGENTS.md` contains links to `docs/architecture/` and `docs/evals/`
- `docs/architecture/README.md` exists
- `docs/evals/README.md` exists

**Step 2: Run test to verify it fails**

Run: `node --test tests/root-agents-navigation.test.mjs`
Expected: FAIL because the new index docs do not exist and `AGENTS.md` does not point to them.

**Step 3: Write minimal implementation**

- add the two README index docs
- shorten root `AGENTS.md` by moving domain-specific explanation to links
- keep only repository map, hard invariants, and verification entrypoints at root

**Step 4: Run test to verify it passes**

Run: `node --test tests/root-agents-navigation.test.mjs`
Expected: PASS.

**Step 5: Commit**

```bash
git add AGENTS.md docs/architecture/README.md docs/evals/README.md tests/root-agents-navigation.test.mjs
git commit -m "docs: convert root guidance to navigation layer"
```

### Task 2: Build chat harnesses

**Files:**
- Create: `tests/harness/chat/README.md`
- Create: `tests/harness/chat/api/`
- Create: `tests/harness/chat/playwright/`
- Create: `tests/fixtures/chat/`
- Modify: `package.json`
- Modify: `Makefile`
- Test: `apps/web/tests/chat-harness-manifest.test.ts`
- Test: `apps/app-backend/tests/chat-harness-manifest.test.ts`

**Step 1: Write the failing tests**

Add tests that assert:
- chat harness directories exist
- chat API harness entrypoints exist
- chat Playwright harness entrypoints exist
- fixture README exists

**Step 2: Run tests to verify they fail**

Run the two test files individually from `apps/web` and `apps/app-backend`.
Expected: FAIL.

**Step 3: Write minimal implementation**

Create harnesses for:
- session list and create
- message send and stream success
- SSE disconnect handling
- document-scope selection and mention behavior

Wire commands like:
- `eval:chat:api`
- `eval:chat:smoke`

**Step 4: Run tests to verify they pass**

Run both manifest tests.
Expected: PASS.

**Step 5: Commit**

```bash
git add tests/harness/chat tests/fixtures/chat package.json Makefile apps/web/tests/chat-harness-manifest.test.ts apps/app-backend/tests/chat-harness-manifest.test.ts
git commit -m "test: add chat harness skeleton"
```

### Task 3: Build auth and project-scope harnesses

**Files:**
- Create: `tests/harness/project-scope/README.md`
- Create: `tests/harness/project-scope/api/`
- Create: `tests/fixtures/project-scope/`
- Modify: `package.json`
- Modify: `Makefile`
- Test: `apps/app-backend/tests/project-scope-harness-manifest.test.ts`

**Step 1: Write the failing test**

Create a manifest test asserting auth/project-scope harness files exist.

**Step 2: Run test to verify it fails**

Run: `cd apps/app-backend && node --import tsx --test tests/project-scope-harness-manifest.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Create API harnesses for:
- login + refresh
- personal project access
- team-scope access
- invalid owner/project combinations

Add `eval:project-scope:api`.

**Step 4: Run test to verify it passes**

Expected: PASS.

**Step 5: Commit**

```bash
git add tests/harness/project-scope tests/fixtures/project-scope package.json Makefile apps/app-backend/tests/project-scope-harness-manifest.test.ts
git commit -m "test: add project scope harness skeleton"
```

### Task 4: Build plugin runtime harnesses

**Files:**
- Create: `tests/harness/plugins/README.md`
- Create: `tests/harness/plugins/api/`
- Create: `tests/harness/plugins/playwright/`
- Create: `tests/fixtures/plugins/`
- Test: `apps/web/tests/plugin-harness-manifest.test.ts`
- Test: `apps/app-backend/tests/plugin-harness-manifest.test.ts`

**Step 1: Write the failing tests**

Add tests for plugin harness directory and script presence.

**Step 2: Run tests to verify they fail**

Expected: FAIL.

**Step 3: Write minimal implementation**

Create harnesses for:
- plugin install / enable / disable
- frontend asset load
- local-data read/write
- route/menu registration
- runtime command execution

**Step 4: Run tests to verify they pass**

Expected: PASS.

**Step 5: Commit**

```bash
git add tests/harness/plugins tests/fixtures/plugins apps/web/tests/plugin-harness-manifest.test.ts apps/app-backend/tests/plugin-harness-manifest.test.ts
git commit -m "test: add plugin runtime harness skeleton"
```

### Task 5: Add repository-wide harness index docs

**Files:**
- Create: `docs/architecture/chat.md`
- Create: `docs/architecture/project-scope.md`
- Create: `docs/architecture/plugins.md`
- Create: `docs/evals/chat.md`
- Create: `docs/evals/project-scope.md`
- Create: `docs/evals/plugins.md`
- Test: `tests/domain-doc-index.test.mjs`

**Step 1: Write the failing test**

Create a test to assert all architecture/eval docs exist for the four core domains.

**Step 2: Run test to verify it fails**

Expected: FAIL.

**Step 3: Write minimal implementation**

Write concise docs for:
- architecture boundaries
- seed requirements
- harness commands
- common failure signatures

**Step 4: Run test to verify it passes**

Expected: PASS.

**Step 5: Commit**

```bash
git add docs/architecture docs/evals tests/domain-doc-index.test.mjs
git commit -m "docs: add domain architecture and eval indexes"
```

### Task 6: Introduce repository-level doctor/bootstrap orchestration

**Files:**
- Create: `scripts/dev/repo-doctor.mjs`
- Create: `scripts/dev/repo-bootstrap.mjs`
- Modify: `package.json`
- Modify: `Makefile`
- Test: `tests/repo-doctor-contract.test.mjs`

**Step 1: Write the failing test**

Add a test that asserts `repo-doctor` reports all core domains and runtime dependencies.

**Step 2: Run test to verify it fails**

Expected: FAIL.

**Step 3: Write minimal implementation**

Implement checks for:
- `server`
- `app-backend`
- `web`
- PostgreSQL alignment
- test accounts
- core harness fixture availability

Add package and make targets for `doctor:repo` and `bootstrap:repo`.

**Step 4: Run test to verify it passes**

Expected: PASS.

**Step 5: Commit**

```bash
git add scripts/dev/repo-doctor.mjs scripts/dev/repo-bootstrap.mjs package.json Makefile tests/repo-doctor-contract.test.mjs
git commit -m "chore: add repository doctor and bootstrap"
```

### Task 7: Create worktree-native runtime layout

**Files:**
- Create: `scripts/dev/worktree-env.mjs`
- Create: `docs/runbooks/worktree-runtime.md`
- Modify: `scripts/dev/repo-bootstrap.mjs`
- Test: `tests/worktree-env-contract.test.mjs`

**Step 1: Write the failing test**

Add a test asserting `worktree-env.mjs --json` returns keys for ports, data roots, and artifact roots.

**Step 2: Run test to verify it fails**

Expected: FAIL.

**Step 3: Write minimal implementation**

Generate deterministic per-worktree values for:
- `web` port
- `app-backend` port
- optional `server` port
- artifact root
- seed namespace or project suffixes

Document the policy in `docs/runbooks/worktree-runtime.md`.

**Step 4: Run test to verify it passes**

Expected: PASS.

**Step 5: Commit**

```bash
git add scripts/dev/worktree-env.mjs docs/runbooks/worktree-runtime.md tests/worktree-env-contract.test.mjs
git commit -m "chore: add worktree runtime contract"
```

### Task 8: Add mechanical enforcement for key invariants

**Files:**
- Create: `tests/invariants/owner-scope-contract.test.mjs`
- Create: `tests/invariants/domain-boundary-contract.test.mjs`
- Create: `tests/invariants/docs-freshness.test.mjs`
- Modify: `package.json`
- Modify: `Makefile`

**Step 1: Write the failing tests**

Add three tests:
- owner-scope invariants for routes and projectRef handling
- domain-boundary invariants for forbidden imports or file patterns
- docs freshness invariants for architecture/eval docs

**Step 2: Run tests to verify they fail**

Expected: FAIL.

**Step 3: Write minimal implementation**

Implement simple file-system based checks first. Do not wait for a full custom linter.

**Step 4: Run tests to verify they pass**

Expected: PASS.

**Step 5: Commit**

```bash
git add tests/invariants package.json Makefile
git commit -m "test: add harness engineering invariants"
```

### Task 9: Add artifact governance and cleanup rules

**Files:**
- Create: `scripts/dev/cleanup-debug-artifacts.mjs`
- Modify: `.gitignore`
- Modify: `docs/evals/README.md`
- Test: `tests/debug-artifact-governance.test.mjs`

**Step 1: Write the failing test**

Add a test asserting:
- `output/harness/` is the stable artifact root
- `output/playwright/` is treated as debug-only
- cleanup script exists

**Step 2: Run test to verify it fails**

Expected: FAIL.

**Step 3: Write minimal implementation**

Add a cleanup script and document artifact classes:
- stable harness outputs
- ephemeral debug outputs

Update `.gitignore` where needed to keep debug surfaces out of commits by default.

**Step 4: Run test to verify it passes**

Expected: PASS.

**Step 5: Commit**

```bash
git add scripts/dev/cleanup-debug-artifacts.mjs .gitignore docs/evals/README.md tests/debug-artifact-governance.test.mjs
git commit -m "chore: add debug artifact governance"
```

### Task 10: Add review and merge evidence templates

**Files:**
- Create: `docs/runbooks/review-with-harness-evidence.md`
- Create: `docs/runbooks/merge-readiness.md`
- Modify: `AGENTS.md`
- Test: `tests/review-evidence-docs.test.mjs`

**Step 1: Write the failing test**

Add a doc-existence test for review and merge runbooks.

**Step 2: Run test to verify it fails**

Expected: FAIL.

**Step 3: Write minimal implementation**

Document:
- required evidence per change class
- minimum harness expectations before merge
- how to summarize agent-produced proof for humans

Link these runbooks from `AGENTS.md`.

**Step 4: Run test to verify it passes**

Expected: PASS.

**Step 5: Commit**

```bash
git add docs/runbooks/review-with-harness-evidence.md docs/runbooks/merge-readiness.md AGENTS.md tests/review-evidence-docs.test.mjs
git commit -m "docs: add review and merge evidence runbooks"
```

### Task 11: Add a repository-wide harness umbrella command

**Files:**
- Modify: `package.json`
- Modify: `Makefile`
- Modify: `docs/evals/README.md`
- Test: `tests/repo-eval-command-contract.test.mjs`

**Step 1: Write the failing test**

Add a test asserting presence of umbrella commands such as:
- `eval:repo:smoke`
- `make repo-eval`

**Step 2: Run test to verify it fails**

Expected: FAIL.

**Step 3: Write minimal implementation**

Wire a top-level smoke bundle that runs:
- document flow
- chat
- project scope
- plugins

Document expected runtime and artifact locations.

**Step 4: Run test to verify it passes**

Expected: PASS.

**Step 5: Commit**

```bash
git add package.json Makefile docs/evals/README.md tests/repo-eval-command-contract.test.mjs
git commit -m "chore: add repository eval umbrella"
```

### Task 12: Run the full roadmap Phase 0 validation pass

**Files:**
- Modify: `docs/evals/README.md`
- Create: `output/harness/.gitkeep`

**Step 1: Run the full validation set**

Run the entire Phase 0 baseline:

```bash
npm run i18n:build
node --test tests/root-agents-navigation.test.mjs tests/repo-doctor-contract.test.mjs tests/domain-doc-index.test.mjs tests/debug-artifact-governance.test.mjs tests/review-evidence-docs.test.mjs tests/repo-eval-command-contract.test.mjs
cd apps/app-backend && node --import tsx --test tests/project-scope-harness-manifest.test.ts tests/chat-harness-manifest.test.ts tests/plugin-harness-manifest.test.ts && npm run build
cd ../web && node --import tsx --test tests/chat-harness-manifest.test.ts tests/plugin-harness-manifest.test.ts tests/document-flow-playwright-manifest.test.ts && npm run build
cd ../.. && make repo-eval
```

Expected: all baseline tests pass and `output/harness/` contains stable run artifacts.

**Step 2: Update docs with the final validation sequence**

Document the exact baseline verification order in `docs/evals/README.md`.

**Step 3: Commit**

```bash
git add docs/evals/README.md output/harness/.gitkeep
git commit -m "test: validate harness engineering baseline"
```
