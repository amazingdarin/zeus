# Project Scope Evals

Project-scope evals verify that auth and owner-scoped access rules are enforced consistently across server and app-backend layers.

## Current Focus

The current phase covers two layers:

1. personal owner scope baseline
2. team role matrix extension

## Current Entry Points

- `npm run seed:project-scope`
- `npm run eval:project-scope:api`
- `npm run eval:project-scope:personal`
- `npm run eval:project-scope:team`
- `make project-scope-eval`
- `make project-scope-seed`

## Personal Owner Scope Coverage

The personal owner scope harnesses cover:

- auth smoke for the automation account
- valid `personal::me::<project>` access
- invalid owner key rejection
- explicit cross-user personal owner rejection
- browser-level projectRef round-trip validation for `personal-project-ref`

## Team Role Matrix Coverage

The team role matrix harnesses cover:

- read success for `owner`, `admin`, `member`, and `viewer`
- write success for `owner`, `admin`, and `member`
- write denial for `viewer`
- read and write denial for outsider identities
- browser-level projectRef round-trip validation for `team-project-ref`

## Seed Requirement

Run the project-scope seed before team-scope evals:

```bash
npm run seed:project-scope
```

The seed provisions:
- the stable team fixture and project
- the role account registry in `output/playwright/project-scope-team-accounts.json`
- per-role write-probe documents for writable team identities

## Browser Harnesses

The browser harnesses validate frontend project selection state against backend route construction:

- `tests/harness/project-scope/playwright/personal-project-ref.mjs`
- `tests/harness/project-scope/playwright/team-project-ref.mjs`

Browser harnesses do not replace the permission matrix. They only prove that frontend `projectRef` encoding still round-trips into the expected request path.

## Validation Sequence

Run the full project-scope validation bundle with:

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
