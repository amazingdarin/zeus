# Project Scope Evals

Project-scope evals verify that auth and owner-scoped access rules are enforced consistently across server and app-backend layers.

## Current Focus

The current phase targets **personal owner scope** first, then expands into the team role matrix.

## Current Entry Points

- `npm run eval:project-scope:api`
- `npm run eval:project-scope:personal`
- `make project-scope-eval`

## Personal Owner Scope Coverage

The current personal owner scope harnesses cover:

- auth smoke for the automation account
- valid `personal::me::<project>` access
- invalid owner key rejection
- explicit cross-user personal owner rejection
- browser-level projectRef round-trip validation

## Browser Harness

The browser harness verifies that a frontend `projectRef` resolves into the expected owner-scoped request path when the app performs project-scoped document requests.

## Next Step

After these personal owner scope harnesses are stable, expand the same fixture and helper shape into team `owner/admin/member/viewer` role checks.

## Validation Sequence

Run the personal owner scope validation bundle with:

```bash
cd apps/app-backend && node --import tsx --test tests/project-scope-fixture-contract.test.ts tests/project-scope-harness-manifest.test.ts
cd ../web && node --import tsx --test tests/project-scope-playwright-manifest.test.ts
cd ../.. && npm run eval:project-scope:api && npm run eval:project-scope:personal
node scripts/dev/run-playwright-harness.mjs tests/harness/project-scope/playwright/personal-project-ref.mjs
```
