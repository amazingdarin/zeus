# Project Scope Team Matrix Design

**Date:** 2026-03-08
**Status:** Approved
**Scope:** Internal harness-engineering expansion for team-scoped project access

## Summary

This design extends the project-scope behavior harness from personal owner scope into a team role matrix. The new layer verifies that team-scoped project routes enforce the expected read and write permissions for `owner`, `admin`, `member`, `viewer`, and a non-member outsider.

The goal is not to expand UI semantics yet. The goal is to make the backend owner-scope boundary mechanically reviewable through stable fixtures, seeded team membership, named API harnesses, and one browser round-trip harness for frontend `projectRef` alignment.

## Goals

1. Prove that team-scoped project routes allow reads for all team members.
2. Prove that write-gated team-scoped routes allow `owner`, `admin`, and `member`, while rejecting `viewer`.
3. Prove that non-members are rejected for both read and write access.
4. Keep team `projectRef` round-trip behavior aligned between frontend state and backend route construction.
5. Reuse the same fixture and harness shape established by personal owner scope.

## Non-Goals

1. Do not validate project list UI semantics such as `CanCreate` or `CanWrite` in this phase.
2. Do not change role definitions or permission rules.
3. Do not refactor owner-scope middleware or project APIs.
4. Do not make browser harnesses the primary permission proof layer.
5. Do not mix environment provisioning into the behavior harnesses themselves.

## Current Permission Contract

The existing permission model already defines these team roles:

- `owner`
- `admin`
- `member`
- `viewer`

The current write contract is implemented in `/Users/darin/mine/code/zeus/apps/app-backend/src/middleware/project-scope-resolver.ts`, where `owner`, `admin`, and `member` resolve to `canWrite = true`, while `viewer` resolves to `canWrite = false`.

This matches the role model in `/Users/darin/mine/code/zeus/server/internal/domain/team.go`.

## Scope of Verification

This phase covers only project-scoped route behavior.

### Read Behavior

Use a stable read route:

- `GET /api/projects/team/:ownerKey/:projectKey/documents/tree`

Expected result:

- `owner`: success
- `admin`: success
- `member`: success
- `viewer`: success
- outsider: `403 PROJECT_ACCESS_DENIED`

### Write Behavior

Use a low-noise write-gated route:

- `PUT /api/projects/team/:ownerKey/:projectKey/documents/:docId/lock`
- `DELETE /api/projects/team/:ownerKey/:projectKey/documents/:docId/lock`

Expected result:

- `owner`: success
- `admin`: success
- `member`: success
- `viewer`: `403 PROJECT_ACCESS_DENIED`
- outsider: `403 PROJECT_ACCESS_DENIED`

The lock route is preferred because it is small, repeatable, and directly exercises write gating without creating noisy persistent test data.

## Fixture Strategy

Add a dedicated team fixture under `/Users/darin/mine/code/zeus/tests/fixtures/project-scope/team.json`.

### Required Fixture Fields

- `ownerType`
- `ownerKey`
- `projectKey`
- `writeProbeDocId`
- `roles.owner`
- `roles.admin`
- `roles.member`
- `roles.viewer`
- `roles.outsider`

Each role entry should provide the stable identity reference needed by harnesses to log in and assert behavior.

### Identity Source

Harnesses must not hardcode live credentials. They should resolve test identities from the shared Playwright account storage and fixture metadata.

The fixture may reference either:

- direct login email addresses already provisioned for automation
- stable account keys resolved through `/Users/darin/mine/code/zeus/output/playwright/test-account.json`

The exact encoding can be chosen during implementation, but the harness must consume a documented fixture contract instead of embedding ad-hoc credentials.

## Environment Provisioning

Environment setup belongs to seed and ensure scripts, not to behavior harnesses.

The seed layer should guarantee:

- the team exists
- the team-scoped project exists
- the write-probe document exists
- role membership is correct for `owner`, `admin`, `member`, and `viewer`
- the outsider account exists and is not a team member

This keeps the harnesses deterministic and makes failures easier to classify as either environment drift or permission regression.

## Harness Structure

### API Harnesses

Add named API harnesses under `/Users/darin/mine/code/zeus/tests/harness/project-scope/api/`:

- `team-read-matrix.mjs`
- `team-write-matrix.mjs`
- `team-outsider-denied.mjs`
- `team-project-ref-roundtrip.mjs`

These are the primary proof layer.

### Browser Harness

Add one browser harness under `/Users/darin/mine/code/zeus/tests/harness/project-scope/playwright/`:

- `team-project-ref.mjs`

This browser harness should only verify that frontend team `projectRef` state resolves into the expected team-scoped request path. It should not duplicate the full permission matrix in the browser.

## Error Expectations

The harnesses should assert the class of failure, not just that a request fails.

For denied team access, the expected failure class is:

- `403 PROJECT_ACCESS_DENIED`

This phase should not treat unrelated `404` or generic `500` failures as acceptable substitutes for permission checks.

## Documentation Impact

Update the project-scope architecture and eval docs so they describe the two-layer shape clearly:

1. personal owner scope baseline
2. team role matrix extension

The eval doc should list exact validation commands for:

- fixture contract tests
n- manifest tests
- personal API harnesses
- team API harnesses
- personal Playwright round-trip
- team Playwright round-trip

## Success Criteria

This phase is successful when:

1. team route permissions are enforced through named harnesses rather than informal assumptions
2. `viewer` write denial is reproducible and reviewable
3. outsider denial is reproducible and reviewable
4. one browser harness proves team `projectRef` round-trip behavior remains aligned
5. personal and team project-scope coverage share a consistent fixture and harness structure

## Recommendation

Implement the team role matrix as an API-first expansion with one browser round-trip harness. Keep environment provisioning in seed scripts, keep permission proof in harnesses, and defer UI permission semantics to a later phase.
