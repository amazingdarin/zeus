# Unified Migration Manager Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a unified migration planning capability that parses `YYYYMMDD-NNN-vX.Y.Z` migrations, resolves app-version matrix mapping, and produces deterministic upgrade/rollback plans per target/track.

**Architecture:** Implement a TypeScript migration core in `apps/app-backend/src/migrations` with pure functions for id parsing, matrix loading, and planning. Expose a lightweight CLI script for `plan` and `status` operations using repository-level `ddl/release-matrix.yaml` and track directories.

**Tech Stack:** TypeScript (Node ESM), node:test, YAML parsing (`yaml`), semver.

---

### Task 1: Migration ID Parser and Ordering

**Files:**
- Create: `apps/app-backend/src/migrations/migration-id.ts`
- Create: `apps/app-backend/src/migrations/types.ts`
- Test: `apps/app-backend/tests/migration-id.test.ts`

**Step 1: Write the failing test**

Create tests for:
1. valid id parse (`20260301-001-v1.0.0`)
2. invalid id rejection
3. stable ordering by date + sequence + id

**Step 2: Run test to verify it fails**

Run: `pnpm --filter zeus-app-backend exec node --import tsx --test tests/migration-id.test.ts`  
Expected: FAIL because parser module does not exist.

**Step 3: Write minimal implementation**

Implement:
1. strict regex parser
2. normalized struct output
3. compare helper for ordering

**Step 4: Run test to verify it passes**

Run: `pnpm --filter zeus-app-backend exec node --import tsx --test tests/migration-id.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/app-backend/src/migrations/migration-id.ts apps/app-backend/src/migrations/types.ts apps/app-backend/tests/migration-id.test.ts
git commit -m "feat: add migration id parser and ordering helpers"
```

### Task 2: Release Matrix Loader and Resolution

**Files:**
- Create: `apps/app-backend/src/migrations/release-matrix.ts`
- Test: `apps/app-backend/tests/release-matrix.test.ts`

**Step 1: Write the failing test**

Create tests for:
1. load and validate matrix schema
2. resolve target tracks (`mobile|desktop|server`)
3. resolve app-version to per-track schema versions
4. fail when app-version missing

**Step 2: Run test to verify it fails**

Run: `pnpm --filter zeus-app-backend exec node --import tsx --test tests/release-matrix.test.ts`  
Expected: FAIL because loader module does not exist.

**Step 3: Write minimal implementation**

Implement:
1. YAML loader from file path
2. structural validation
3. deterministic lookup helpers

**Step 4: Run test to verify it passes**

Run: `pnpm --filter zeus-app-backend exec node --import tsx --test tests/release-matrix.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/app-backend/src/migrations/release-matrix.ts apps/app-backend/tests/release-matrix.test.ts
git commit -m "feat: add release matrix loader and version resolution"
```

### Task 3: Upgrade/Rollback Planner Core

**Files:**
- Create: `apps/app-backend/src/migrations/planner.ts`
- Test: `apps/app-backend/tests/migration-planner.test.ts`

**Step 1: Write the failing test**

Create tests for:
1. plan upgrade to app version where DB target is lower than app version
2. exclude already-applied migrations
3. rollback selection in reverse order
4. filtering by explicit track

**Step 2: Run test to verify it fails**

Run: `pnpm --filter zeus-app-backend exec node --import tsx --test tests/migration-planner.test.ts`  
Expected: FAIL because planner module does not exist.

**Step 3: Write minimal implementation**

Implement:
1. filesystem migration discovery per track
2. semver comparison against target schema version
3. deterministic upgrade and rollback plan output

**Step 4: Run test to verify it passes**

Run: `pnpm --filter zeus-app-backend exec node --import tsx --test tests/migration-planner.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/app-backend/src/migrations/planner.ts apps/app-backend/tests/migration-planner.test.ts
git commit -m "feat: add migration plan engine for upgrade and rollback"
```

### Task 4: CLI Entry for plan/status

**Files:**
- Create: `apps/app-backend/src/scripts/migrate-manager.ts`
- Modify: `apps/app-backend/package.json`
- Test: `apps/app-backend/tests/migrate-manager-cli.test.ts`

**Step 1: Write the failing test**

Create tests for:
1. `plan up` JSON output
2. `plan down` JSON output
3. validation errors for missing args

**Step 2: Run test to verify it fails**

Run: `pnpm --filter zeus-app-backend exec node --import tsx --test tests/migrate-manager-cli.test.ts`  
Expected: FAIL because CLI script does not exist.

**Step 3: Write minimal implementation**

Implement:
1. CLI args parsing
2. matrix + planner integration
3. machine-readable JSON output

**Step 4: Run test to verify it passes**

Run: `pnpm --filter zeus-app-backend exec node --import tsx --test tests/migrate-manager-cli.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/app-backend/src/scripts/migrate-manager.ts apps/app-backend/package.json apps/app-backend/tests/migrate-manager-cli.test.ts
git commit -m "feat: add migration manager cli for plan and status"
```

### Task 5: Verification Sweep

**Files:**
- Test: `apps/app-backend/tests/migration-id.test.ts`
- Test: `apps/app-backend/tests/release-matrix.test.ts`
- Test: `apps/app-backend/tests/migration-planner.test.ts`
- Test: `apps/app-backend/tests/migrate-manager-cli.test.ts`

**Step 1: Run focused suite**

Run:
```bash
pnpm --filter zeus-app-backend exec node --import tsx --test \
  tests/migration-id.test.ts \
  tests/release-matrix.test.ts \
  tests/migration-planner.test.ts \
  tests/migrate-manager-cli.test.ts
```

Expected: all tests PASS.

**Step 2: Smoke-run CLI**

Run:
```bash
pnpm --filter zeus-app-backend exec node --import tsx src/scripts/migrate-manager.ts plan up --target server --to-app-version v1.1.0
```

Expected: JSON plan output with schema target `v1.0.0` per `release-matrix.yaml`.

**Step 3: Commit**

```bash
git add apps/app-backend/src/migrations apps/app-backend/src/scripts/migrate-manager.ts apps/app-backend/tests apps/app-backend/package.json
git commit -m "feat: implement migration manager planning core and cli"
```

