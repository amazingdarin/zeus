# Harness Engineering for Document Flow Design

**Date:** 2026-03-07
**Status:** Approved
**Scope:** Internal Zeus engineering workflow only

## Summary

This design proposes a Phase 1 harness-engineering pilot for Zeus focused on the document flow. The goal is not to productize a general-purpose agent platform yet. The goal is to make the Zeus document stack easier for coding agents and engineers to understand, modify, validate, and debug with low ambiguity and low setup cost.

The pilot covers the end-to-end document path across `apps/web`, `apps/app-backend`, and the local development environment. It prioritizes reproducible environments and regression harnesses before large-scale refactors. Refactors are still part of the phase, but only after verification entrypoints are stable.

## Why This Change

Zeus already has several useful ingredients for agent-oriented development:

- project-level guidance in `/Users/darin/mine/code/zeus/AGENTS.md`
- a growing set of design and implementation plans in `/Users/darin/mine/code/zeus/docs/plans/`
- multiple active worktrees
- Playwright-based regression scripts
- increasingly modular document-domain state in `apps/web/src/features/document-page/`

The current gaps are operational rather than conceptual:

- key project knowledge is still too concentrated in root-level instructions and engineer memory
- regression coverage exists, but it is still partly organized as debug scripts instead of a stable harness
- local environment drift remains possible, especially across `server`, `apps/app-backend`, and `apps/web`
- large files such as `apps/web/src/pages/DocumentPage.tsx` and `apps/app-backend/src/router.ts` still carry too much mixed responsibility
- fixture setup is not yet a first-class, repeatable part of development

If left unchanged, coding-agent output quality will remain inconsistent because the code-writing step is increasingly cheap, while setup, validation, and debugging remain expensive.

## Goals

1. Make the document flow reproducible from a fresh worktree with minimal manual setup.
2. Turn document regression checks into a stable harness with named entrypoints, fixed fixtures, and consistent outputs.
3. Reduce the amount of hidden context required to change document behavior safely.
4. Create a document-domain pilot that can later be extended to chat, plugins, and team/project workflows.
5. Convert newly found bugs into durable regression assets instead of one-off fixes.

## Non-Goals

1. Do not redesign the entire Zeus architecture in this phase.
2. Do not productize harness-engineering features for end users yet.
3. Do not fully rewrite the plugin system.
4. Do not fully split every large file in the repository during Phase 1.
5. Do not replace existing auth, project scope, or deployment stacks unless needed by document-flow harnesses.

## Phase 1 Focus Area

The pilot is intentionally narrow. It covers the main document path only.

### In Scope

- document page shell and layout
- document tree and tree actions
- document tabs and position restore
- document editor boot/mount behavior
- document title synchronization across title, breadcrumb, tree, and tabs
- document lock/unlock behavior
- document block comments
- document empty-project and ephemeral-draft behavior
- document page side-panel interactions that affect the current document context
- project-scoped APIs needed by the document page in `apps/app-backend`
- seed data and local environment checks required to reproduce the above

### Out of Scope

- full chat workflow beyond document-context checks
n- generic plugin authoring workflow
- team administration and invitation flows
- code-runner productization
- full deployment hardening for non-document domains

## Recommended Operating Model

Phase 1 adopts a `harness-first, refactor-second` model.

### Order of Work

1. Standardize environment checks and seed data.
2. Standardize document-flow regression harnesses.
3. Promote existing ad-hoc scripts into named harness commands.
4. Only then split large document-domain files behind passing harnesses.

This ordering is the most important design choice. Without it, refactors will keep changing the target while the validation layer remains unstable.

## Target Developer Experience

From a fresh worktree, a developer or coding agent should be able to do the following:

1. run one doctor/bootstrap command and learn whether the environment is usable
2. seed a known document project with stable fixtures
3. run a small document-flow smoke suite in under a few minutes
4. implement a document-domain change
5. rerun the same harness and see exactly which contract changed
6. inspect artifacts from a single output directory for that run

The main cost center must shift from setup and guesswork to actual engineering decisions.

## Architecture Overview

Phase 1 adds a thin harness layer on top of the existing codebase rather than introducing a new runtime platform.

### 1. Knowledge Layer

Replace the current “single giant instruction file” pattern with a short root navigation layer plus document-domain knowledge closer to the code.

Target additions:

- `docs/architecture/document-flow.md`
- `docs/evals/document-flow.md`
- `tests/fixtures/document-flow/README.md`
- domain-local guidance near `apps/web/src/features/document-page/`
- domain-local guidance near `apps/app-backend/src/services/document-*`

Root `AGENTS.md` remains, but it should primarily route the agent to local knowledge rather than attempt to encode all document behavior itself.

### 2. Environment Layer

The environment layer prevents invalid local states before any code is changed.

Target capabilities:

- doctor command for `server`, `app-backend`, `web`, ports, DB alignment, and test-account availability
- bootstrap command to start the document-flow stack predictably
- seed/reset commands for the document project used by regression tests
- explicit checks that `server` and `app-backend` point to the same PostgreSQL instance

### 3. Harness Layer

Promote document-flow checks into named suites.

Target structure:

- `tests/harness/document-flow/playwright/`
- `tests/harness/document-flow/api/`
- `tests/harness/document-flow/helpers/`
- `tests/fixtures/document-flow/`
- `output/harness/document-flow/<run-id>/`

This separates durable harnesses from temporary debug scripts in `output/playwright/`.

### 4. Application Refactor Layer

Refactors happen behind passing harnesses and stay limited to the document path.

Primary web targets:

- `/Users/darin/mine/code/zeus/apps/web/src/pages/DocumentPage.tsx`
- `/Users/darin/mine/code/zeus/apps/web/src/components/KnowledgeBaseSideNav.tsx`
- `/Users/darin/mine/code/zeus/apps/web/src/components/DocumentWorkspace.tsx`

Primary backend targets:

- `/Users/darin/mine/code/zeus/apps/app-backend/src/router.ts`
- document-domain services under `/Users/darin/mine/code/zeus/apps/app-backend/src/services/`

The goal is not aesthetic cleanup. The goal is to reduce cross-domain coupling so agents can change one area without loading the entire document system into context.

## Required Harnesses

Phase 1 should define a minimum stable set of document-flow tasks.

### Web UI Harnesses

1. login and land on documents
2. load document tree
3. open a document and render the editor/viewer without crash
4. rename document and verify title/breadcrumb/tree/tab synchronization
5. create child document in the unified page
6. switch tabs and restore position
7. lock/unlock document and verify immediate readonly/editable response
8. open block comments and create/reply/delete on seeded blocks
9. validate empty-project ephemeral-draft behavior
10. switch zh-CN and en and verify critical document UI labels

### API Harnesses

1. project-scoped document tree fetch
2. document read and hierarchy fetch
3. comment thread list/detail/create/reply/update/delete
4. document lock and unlock
5. favorites/recent/trash routes
6. document title update and duplicate
7. app-backend locale-aware error responses for document-domain errors

### Environment Harnesses

1. project scope resolves for the seeded personal project
2. `server` and `app-backend` share the same project data source
3. test account exists and can access the seeded project
4. plugin runtime loads without document-context bootstrap warnings for the seeded document path

## Data and Fixture Strategy

Fixtures must stop depending on whatever happened in a developer’s workspace yesterday.

### Seeded Entities

The document-flow seed should create or verify:

- one stable test user from `output/playwright/test-account.json`
- one personal project for that user
- at least three documents in a known tree shape
- one locked document
- one document with comments on seeded block IDs
- one empty project used only for ephemeral-draft tests

### Fixture Storage

Recommended fixture sources:

- JSON/Tiptap payloads in `tests/fixtures/document-flow/`
- optional SQL or API-driven seed scripts under `scripts/dev/`
- screenshots and traces written only to `output/harness/document-flow/`

### Reset Policy

Every seeded run should be able to either:

- fully recreate known data from scratch, or
- validate current state and reconcile drift deterministically

The second option is often more practical locally, but the result must still be deterministic.

## Knowledge Compression Strategy

The existing root-level guidance is valuable but too large to be the only entrypoint.

Phase 1 should introduce a layered knowledge model:

1. root `AGENTS.md`: repository map, invariants, command entrypoints
2. domain architecture doc: how document flow is structured
3. eval doc: which harnesses exist and when to run them
4. local code-adjacent docs: state model and data-flow notes near the code

The guiding rule is that any document-domain task should be solvable by reading one short root guide plus one domain guide, not by re-reading the whole repository brief.

## Error Handling and Debuggability

Harness engineering only works if failure output is actionable.

Phase 1 failures should always answer:

- which layer failed: environment, API, UI, or fixture
- whether the failure is reproducible
- where the relevant artifacts are stored
- which project/document fixture was active

Every document-flow harness run should include a stable run folder containing at least:

- console logs
- network summary
- screenshots for failing steps
- fixture metadata
- selected project/document identifiers

## Testing Strategy

Testing for this phase is layered.

### Fast Feedback

- small TypeScript tests for state models and helpers
- focused backend unit tests for document services and i18n responses
- environment doctor checks

### Medium Feedback

- API smoke tests against the seeded project
- Playwright document-flow smoke tests

### Slow Feedback

- broader document regression suites with screenshots and artifact capture

The default path for most agent changes should use the fast and medium layers. Slow suites should be required before merge for riskier UI behavior.

## Success Metrics

The pilot is successful if, after Phase 1:

1. document-flow setup from a clean worktree is deterministic
2. at least 8-10 named harness tasks are stable and documented
3. document-domain regressions can be reproduced without manual tribal knowledge
4. changes to the document page no longer require understanding the entire page component first
5. each newly fixed document bug results in a durable regression case or fixture update

## Risks

### Risk 1: Refactor Before Harness

This would create more churn without increasing agent reliability.

Mitigation:
- require harness entrypoints before structural document-page refactors

### Risk 2: Harnesses Stay in Debug Directories

If durable checks remain mixed with temporary scripts, entropy will continue to grow.

Mitigation:
- create a dedicated `tests/harness/document-flow/` home
- reserve `output/playwright/` for ad-hoc debugging only

### Risk 3: Environment Drift Returns

Even good regression scripts are useless if `server` and `app-backend` do not share the same project data.

Mitigation:
- make doctor/bootstrap verify data-source alignment explicitly

### Risk 4: Knowledge Re-Accumulates at Root

If every new rule goes back into root `AGENTS.md`, context weight will climb again.

Mitigation:
- add a rule that new document-domain knowledge must live in document-domain docs unless it is a cross-repo invariant

## Recommended Phase 1 Deliverables

1. document-flow design and implementation docs
2. environment doctor/bootstrap commands
3. document-flow seed/reset commands
4. dedicated harness directory for document flow
5. stable Playwright and API smoke suites for the seeded project
6. first-pass document-page and document-router decomposition plan
7. domain-level architecture and eval documentation

## Recommendation

Proceed with a single document-flow pilot, not a repository-wide transformation.

The right way to adopt harness engineering in Zeus is to prove it on the document stack first. That path has the strongest user value, the heaviest state coordination, and the richest existing regression surface. If the team can make document flow reproducible, low-context, and eval-driven, the same model can then be extended to chat, plugins, and broader project workflows with far less guesswork.
