# Document Flow Regression Evals

Document flow regression evals cover the seeded document project and the critical user tasks that must remain stable.

## Required Seed State

Run the doctor and seed commands before relying on any document-flow harness. The harness assumes these two fixed projects exist:

- `playwright-doc-flow`
- `playwright-doc-flow-empty`

The seeded document project contains these stable documents:

- `doc-flow-root`
- `doc-flow-locked`
- `doc-flow-commented`

## Command Entry Points

Use these commands from the repository root:

```bash
npm run doctor:doc-flow
npm run reset:doc-flow
npm run seed:doc-flow
npm run eval:doc-flow:smoke
npm run eval:doc-flow:api
npm run eval:doc-flow:ppt-context
```

Equivalent `make` entrypoints:

```bash
make doc-flow-doctor
make doc-flow-seed
make doc-flow-reset
make doc-flow-eval
```

## Harness Coverage

The current Phase 1 harness covers:

- environment doctor checks
- seeded project creation/reset
- document tree smoke validation
- comment-thread API validation
- locked-document API validation
- i18n smoke path
- PPT plugin project-context regression

## Artifact Locations

Current Playwright-backed harnesses write screenshots to:

- `output/harness/document-flow/`

Legacy debug scripts still exist under `output/playwright/`, but stable document-flow harness entrypoints now live under `tests/harness/document-flow/`.
