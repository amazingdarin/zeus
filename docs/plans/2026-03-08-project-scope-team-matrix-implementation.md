# Project Scope Team Matrix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a stable team role matrix harness for project-scoped routes so Zeus can mechanically verify read/write permissions for `owner`, `admin`, `member`, `viewer`, and outsider identities.

**Architecture:** Extend the existing personal owner-scope harness into a team-scoped, API-first matrix. Use a dedicated team fixture, a seed script that provisions team members and a write-probe document, named API harnesses for read/write denial behavior, and one Playwright round-trip harness for team `projectRef` path alignment. Keep permission proof in harnesses and environment setup in seed scripts.

**Tech Stack:** Node test runner, TypeScript manifest tests, Node fetch harnesses, Playwright CLI harness runner, Go auth/team/project APIs, TypeScript app-backend project-scope routes, PostgreSQL-backed local runtime.

---

### Task 1: Extend fixture and manifest contracts for team scope

**Files:**
- Modify: `apps/app-backend/tests/project-scope-fixture-contract.test.ts`
- Modify: `apps/app-backend/tests/project-scope-harness-manifest.test.ts`
- Modify: `apps/web/tests/project-scope-playwright-manifest.test.ts`
- Modify: `tests/fixtures/project-scope/README.md`
- Create: `tests/fixtures/project-scope/team.json`

**Step 1: Write the failing tests**

Extend the contract tests so they require the team fixture and the new team harness entrypoints.

In `apps/app-backend/tests/project-scope-fixture-contract.test.ts`, add a second test that reads `tests/fixtures/project-scope/team.json` and asserts these fields exist and are non-empty strings:

```ts
for (const key of ["ownerType", "ownerKey", "projectKey", "writeProbeDocId"]) {
  assert.equal(typeof fixture[key], "string");
  assert.ok(String(fixture[key]).trim().length > 0);
}
for (const role of ["owner", "admin", "member", "viewer", "outsider"]) {
  assert.equal(typeof fixture.roles?.[role]?.accountKey, "string");
  assert.ok(String(fixture.roles[role].accountKey).trim().length > 0);
}
```

In `apps/app-backend/tests/project-scope-harness-manifest.test.ts`, add these required files:

- `tests/harness/project-scope/api/team-read-matrix.mjs`
- `tests/harness/project-scope/api/team-write-matrix.mjs`
- `tests/harness/project-scope/api/team-outsider-denied.mjs`
- `tests/harness/project-scope/api/team-project-ref-roundtrip.mjs`

In `apps/web/tests/project-scope-playwright-manifest.test.ts`, add:

- `tests/harness/project-scope/playwright/team-project-ref.mjs`

**Step 2: Run tests to verify they fail**

Run:

```bash
cd apps/app-backend && node --import tsx --test tests/project-scope-fixture-contract.test.ts tests/project-scope-harness-manifest.test.ts
cd ../web && node --import tsx --test tests/project-scope-playwright-manifest.test.ts
```

Expected: FAIL because `tests/fixtures/project-scope/team.json` and the team harness files do not exist yet.

**Step 3: Write minimal implementation**

Create `tests/fixtures/project-scope/team.json` with this shape:

```json
{
  "ownerType": "team",
  "ownerKey": "playwright-team-scope",
  "projectKey": "playwright-team-doc-flow",
  "writeProbeDocId": "team-scope-lock-probe",
  "roles": {
    "owner": { "accountKey": "primary" },
    "admin": { "accountKey": "teamAdmin" },
    "member": { "accountKey": "teamMember" },
    "viewer": { "accountKey": "teamViewer" },
    "outsider": { "accountKey": "teamOutsider" }
  }
}
```

Update `tests/fixtures/project-scope/README.md` so it explains:

- personal fixture remains the baseline contract
- team fixture extends it into a role matrix
- role identities resolve through a seeded account registry instead of hardcoded credentials

Do not create placeholder harness files yet. Let the manifest test remain the proof that later tasks still need to add them.

**Step 4: Run tests to verify partial progress**

Run:

```bash
cd apps/app-backend && node --import tsx --test tests/project-scope-fixture-contract.test.ts
cd ../web && node --import tsx --test tests/project-scope-playwright-manifest.test.ts
```

Expected:
- fixture contract: PASS
- manifest test: still FAIL because harness files are still missing

**Step 5: Commit**

```bash
git add tests/fixtures/project-scope/team.json tests/fixtures/project-scope/README.md apps/app-backend/tests/project-scope-fixture-contract.test.ts apps/app-backend/tests/project-scope-harness-manifest.test.ts apps/web/tests/project-scope-playwright-manifest.test.ts
git commit -m "test: add team project scope fixture contract"
```

### Task 2: Add team-scope seed provisioning and account registry helpers

**Files:**
- Create: `scripts/dev/project-scope-seed.mjs`
- Create: `tests/project-scope-seed-contract.test.mjs`
- Create: `tests/harness/project-scope/api/_helpers/team-context.mjs`
- Modify: `package.json`
- Modify: `Makefile`

**Step 1: Write the failing test**

Create `tests/project-scope-seed-contract.test.mjs` to assert:

- `scripts/dev/project-scope-seed.mjs` exists
- `package.json` contains `seed:project-scope`
- `Makefile` contains `project-scope-seed`
- `tests/harness/project-scope/api/_helpers/team-context.mjs` exists

Use the same file-existence style as the existing repo contract tests.

**Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/project-scope-seed-contract.test.mjs
```

Expected: FAIL because none of the seed files or command entries exist.

**Step 3: Write minimal implementation**

Implement `scripts/dev/project-scope-seed.mjs` with these responsibilities:

1. Read `output/playwright/test-account.json` and treat it as the team owner (`primary`).
2. Ensure four additional accounts exist:
   - `teamAdmin`
   - `teamMember`
   - `teamViewer`
   - `teamOutsider`
3. Persist those accounts into `output/playwright/project-scope-team-accounts.json` with this shape:

```json
{
  "primary": { "email": "...", "password": "...", "userId": "..." },
  "teamAdmin": { "email": "...", "password": "...", "userId": "..." },
  "teamMember": { "email": "...", "password": "...", "userId": "..." },
  "teamViewer": { "email": "...", "password": "...", "userId": "..." },
  "teamOutsider": { "email": "...", "password": "...", "userId": "..." }
}
```

4. Ensure the team from `tests/fixtures/project-scope/team.json` exists.
5. Ensure the team project exists under `ownerType=team` and the team slug owner key.
6. Ensure the write-probe document exists at `writeProbeDocId`.
7. Ensure team membership roles are:
   - owner: `primary`
   - admin: `teamAdmin`
   - member: `teamMember`
   - viewer: `teamViewer`
   - outsider: not a member

Use server APIs rather than direct SQL where possible:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET/POST /api/teams`
- `POST /api/teams/:slug/members`
- `PUT /api/teams/:slug/members/:userId`
- `GET /api/projects`
- `POST /api/projects`

Use app-backend document APIs to upsert the write-probe document.

Create `tests/harness/project-scope/api/_helpers/team-context.mjs` with helpers to:

- load `tests/fixtures/project-scope/team.json`
- load `output/playwright/project-scope-team-accounts.json`
- login by role name
- build team project API base: `/api/projects/team/:ownerKey/:projectKey`

Wire commands:

- `package.json`: `"seed:project-scope": "node scripts/dev/project-scope-seed.mjs"`
- `Makefile`: `project-scope-seed: npm run seed:project-scope`

**Step 4: Run tests and seed to verify they pass**

Run:

```bash
node --test tests/project-scope-seed-contract.test.mjs
npm run seed:project-scope
```

Expected:
- contract test: PASS
- seed script: PASS and writes `output/playwright/project-scope-team-accounts.json`

**Step 5: Commit**

```bash
git add scripts/dev/project-scope-seed.mjs tests/project-scope-seed-contract.test.mjs tests/harness/project-scope/api/_helpers/team-context.mjs package.json Makefile
git commit -m "chore: add project scope team seed"
```

### Task 3: Add API-first team role matrix harnesses

**Files:**
- Create: `tests/harness/project-scope/api/team-read-matrix.mjs`
- Create: `tests/harness/project-scope/api/team-write-matrix.mjs`
- Create: `tests/harness/project-scope/api/team-outsider-denied.mjs`
- Create: `tests/harness/project-scope/api/team-project-ref-roundtrip.mjs`
- Modify: `tests/harness/project-scope/api/README.md`
- Modify: `package.json`
- Modify: `Makefile`
- Test: `apps/app-backend/tests/project-scope-harness-manifest.test.ts`

**Step 1: Use the manifest test as the failing check**

Run the manifest test added in Task 1.

Run:

```bash
cd apps/app-backend && node --import tsx --test tests/project-scope-harness-manifest.test.ts
```

Expected: FAIL because the team API harness files do not exist yet.

**Step 2: Write minimal implementation**

Implement `tests/harness/project-scope/api/team-read-matrix.mjs` to iterate over `owner`, `admin`, `member`, and `viewer`:

```js
for (const role of ["owner", "admin", "member", "viewer"]) {
  const ctx = await loginTeamRole(role);
  const { response } = await apiFetch(`${ctx.base}/documents/tree`, ctx.token);
  if (!response.ok) throw new Error(`${role} read failed: ${response.status}`);
}
```

Implement `tests/harness/project-scope/api/team-write-matrix.mjs` to exercise the write-gated lock route on `writeProbeDocId`:

```js
const expected = { owner: 200, admin: 200, member: 200, viewer: 403 };
for (const [role, status] of Object.entries(expected)) {
  const ctx = await loginTeamRole(role);
  const { response } = await apiFetch(`${ctx.base}/documents/${ctx.fixture.writeProbeDocId}/lock`, ctx.token, { method: "PUT" });
  if (response.status !== status) throw new Error(`${role} write mismatch: ${response.status}`);
  if (status === 200) {
    await apiFetch(`${ctx.base}/documents/${ctx.fixture.writeProbeDocId}/lock`, ctx.token, { method: "DELETE" });
  }
}
```

Implement `tests/harness/project-scope/api/team-outsider-denied.mjs` to assert outsider read and write both return `403`.

Implement `tests/harness/project-scope/api/team-project-ref-roundtrip.mjs` to assert:

```js
const projectRef = `team::${fixture.ownerKey}::${fixture.projectKey}`;
const encoded = projectRef.split("::").join("/");
if (encoded !== `team/${fixture.ownerKey}/${fixture.projectKey}`) throw new Error("roundtrip mismatch");
```

Update `tests/harness/project-scope/api/README.md` so it documents:

- personal owner scope baseline
- team role matrix API harnesses
- seed prerequisite: `npm run seed:project-scope`

Add command wiring:

- `package.json`: `eval:project-scope:team`
- expand `eval:project-scope:api` to include `npm run eval:project-scope:team`
- `Makefile`: include `npm run eval:project-scope:team` under `project-scope-eval`

**Step 3: Run tests and harnesses to verify they pass**

Run:

```bash
cd apps/app-backend && node --import tsx --test tests/project-scope-harness-manifest.test.ts
cd ../.. && npm run seed:project-scope && npm run eval:project-scope:team
```

Expected: PASS.

**Step 4: Run the full API bundle**

Run:

```bash
npm run eval:project-scope:api
```

Expected: PASS with personal and team scope checks both succeeding.

**Step 5: Commit**

```bash
git add tests/harness/project-scope/api tests/harness/project-scope/api/README.md package.json Makefile apps/app-backend/tests/project-scope-harness-manifest.test.ts
git commit -m "test: add team project scope api harnesses"
```

### Task 4: Add team projectRef browser round-trip harness

**Files:**
- Create: `tests/harness/project-scope/playwright/team-project-ref.mjs`
- Modify: `tests/harness/project-scope/playwright/README.md`
- Test: `apps/web/tests/project-scope-playwright-manifest.test.ts`

**Step 1: Use the Playwright manifest test as the failing check**

Run:

```bash
cd apps/web && node --import tsx --test tests/project-scope-playwright-manifest.test.ts
```

Expected: FAIL because `tests/harness/project-scope/playwright/team-project-ref.mjs` does not exist yet.

**Step 2: Write minimal implementation**

Implement `tests/harness/project-scope/playwright/team-project-ref.mjs` by following the same shape as `personal-project-ref.mjs`, but use the team fixture and the primary owner account.

The harness should:

1. read `tests/fixtures/project-scope/team.json`
2. set local storage `zeus.lastProjectRef = team::<ownerKey>::<projectKey>`
3. log in with `output/playwright/test-account.json`
4. monkeypatch `window.fetch` with `page.addInitScript()`
5. trigger a team-scoped documents request
6. assert the browser recorded:

```text
/api/projects/team/<ownerKey>/<projectKey>/documents/tree
```

Update `tests/harness/project-scope/playwright/README.md` so it explains that:

- personal harness proves the personal route round-trip
- team harness proves the team route round-trip
- browser harnesses validate path alignment, not the full permission matrix

**Step 3: Run tests and harness to verify they pass**

Run:

```bash
cd apps/web && node --import tsx --test tests/project-scope-playwright-manifest.test.ts
cd ../.. && npm run seed:project-scope
node scripts/dev/run-playwright-harness.mjs tests/harness/project-scope/playwright/team-project-ref.mjs
```

Expected: PASS.

**Step 4: Re-run the personal browser harness for regression protection**

Run:

```bash
node scripts/dev/run-playwright-harness.mjs tests/harness/project-scope/playwright/personal-project-ref.mjs
```

Expected: PASS.

**Step 5: Commit**

```bash
git add tests/harness/project-scope/playwright tests/harness/project-scope/playwright/README.md apps/web/tests/project-scope-playwright-manifest.test.ts
git commit -m "test: add team project scope playwright harness"
```

### Task 5: Update docs and record the full validation bundle

**Files:**
- Modify: `docs/architecture/project-scope.md`
- Modify: `docs/evals/project-scope.md`
- Modify: `docs/evals/README.md`
- Modify: `tests/project-scope-doc-links.test.mjs`

**Step 1: Write the failing doc-links test**

Extend `tests/project-scope-doc-links.test.mjs` so it also asserts the docs mention:

- team role matrix
- `eval:project-scope:team`
- browser round-trip coverage for both personal and team scope
- the seed prerequisite `seed:project-scope`

**Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/project-scope-doc-links.test.mjs
```

Expected: FAIL because the current docs only describe personal owner scope.

**Step 3: Write minimal implementation**

Update the docs so they explain:

- personal owner scope is the base layer
- team role matrix is the second layer
- seed requirements for team accounts and project fixtures
- API harness entrypoints
- Playwright round-trip entrypoints
- future work can later add UI permission semantics and team list contract checks

In `docs/evals/project-scope.md`, record this exact validation sequence:

```bash
node --test tests/project-scope-doc-links.test.mjs tests/project-scope-seed-contract.test.mjs
cd apps/app-backend && node --import tsx --test tests/project-scope-fixture-contract.test.ts tests/project-scope-harness-manifest.test.ts
cd ../web && node --import tsx --test tests/project-scope-playwright-manifest.test.ts
cd ../.. && npm run seed:project-scope
npm run eval:project-scope:personal
npm run eval:project-scope:team
node scripts/dev/run-playwright-harness.mjs tests/harness/project-scope/playwright/personal-project-ref.mjs
node scripts/dev/run-playwright-harness.mjs tests/harness/project-scope/playwright/team-project-ref.mjs
```

**Step 4: Run the full validation bundle**

Run the exact command sequence above.

Expected: PASS end-to-end.

**Step 5: Commit**

```bash
git add docs/architecture/project-scope.md docs/evals/project-scope.md docs/evals/README.md tests/project-scope-doc-links.test.mjs
git commit -m "docs: expand project scope team matrix coverage"
```
