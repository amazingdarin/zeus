# Project Scope Phase 2 Design

**Date:** 2026-03-08
**Status:** Approved
**Scope:** Internal harness-engineering expansion for project scope

## Summary

This design upgrades the current project-scope harness skeleton into a behavior-level harness. The implementation order is intentionally split into two layers:

1. personal owner scope
2. team role matrix

The personal layer comes first because it is the lowest-level owner-scope contract used by document flow, chat, and plugin runtime harnesses. Team-role verification will be added only after the personal-scope behaviors are deterministic and easy to reproduce.

## Goals

1. Prove that `projectRef` resolution is stable for personal scope across frontend and backend.
2. Detect invalid personal owner keys early and consistently.
3. Establish reusable fixture patterns for later team-role expansion.
4. Keep the first phase API-heavy and low-cost before adding more browser-level coverage.

## Non-Goals

1. Do not add full team-role matrix coverage in this first step.
2. Do not refactor the owner-scope architecture yet.
3. Do not change route shapes or public API contracts.
4. Do not couple this work to chat or plugin behavior beyond what is needed for fixture reuse.

## Phase Order

### Phase 2A: Personal Owner Scope

Focus on personal project references and invalid owner combinations.

### Phase 2B: Team Role Matrix

Build on the same harness shape with explicit team fixtures and read/write expectations for `owner`, `admin`, `member`, and `viewer`.

## Personal-Scope Coverage

The first behavior-level harnesses should prove the following:

1. `personal::me::<project>` resolves correctly.
2. `personal::<currentUserId>::<project>` resolves equivalently.
3. `personal::not-me::<project>` is rejected with a stable client-observable failure.
4. frontend `projectRef` serialization and backend owner-scope resolution agree.
5. invalid ownerKey cases fail before drifting into unrelated route behavior.

## Fixture Strategy

Add a project-scope-specific fixture layer under `tests/fixtures/project-scope/`.

### Required Fixture Entities

- current automation user identity
- one stable personal project key owned by the current user
- one alternate personal project key also owned by the current user
- one invalid ownerKey sample for rejection tests

### Fixture Output Shape

Recommended files:

- `tests/fixtures/project-scope/personal.json`
- `tests/fixtures/project-scope/README.md`

The fixture must record both:
- `ownerType`, `ownerKey`, `projectKey`
- the current user ID for explicit-owner equivalence checks

## Harness Structure

### API Harnesses

Add or extend these entries under `tests/harness/project-scope/api/`:

- `auth-smoke.mjs`
- `personal-valid.mjs`
- `personal-invalid-owner.mjs`
- `personal-cross-user-denied.mjs`
- `project-ref-roundtrip.mjs`

The API harnesses are the primary proof layer because they are cheaper and more deterministic than browser tests.

### Browser Harnesses

Add a small browser harness under `tests/harness/project-scope/playwright/`:

- `personal-project-ref.mjs`

This should only validate the most important round-trip:
- write `zeus.lastProjectRef`
- open the app
- trigger a project-scoped fetch
- verify the request path reflects the expected owner/project tuple

## Error Expectations

The harness should not just check “fails.” It should check class of failure.

For invalid personal owner keys, expected behavior should be one of:
- `400 INVALID_OWNER`
- `403 PROJECT_ACCESS_DENIED`

It should not silently fall through into unrelated 404s or generic 500s.

## Reuse by Other Domains

This work should produce a reusable helper for:
- building valid personal project refs
- building invalid owner refs
- asserting backend path round-trip behavior

That helper can later be reused by:
- chat harnesses
- plugin runtime harnesses
- document-flow cross-owner regression checks

## Success Criteria

This phase is successful when:

1. personal owner-scope behavior is enforced through named harnesses rather than implicit assumptions
2. at least one frontend round-trip test proves `projectRef` serialization stays aligned with backend routing
3. invalid ownerKey behavior becomes deterministic and reviewable
4. future team-role matrix work can reuse the same fixture and helper shape

## Recommendation

Proceed with personal owner scope first, keep the first implementation API-first, and add only one browser round-trip harness. Once those checks are stable, expand the same structure into team-role matrix verification.
