# Harness Engineering Full-Roadmap Design

**Date:** 2026-03-08
**Status:** Approved
**Scope:** Internal Zeus engineering transformation

## Summary

This document defines the repository-wide roadmap for converting Zeus from an agent-assisted codebase into an agent-first engineering system built around harness engineering. The target state is not “more AI inside development.” The target state is that the default unit of engineering becomes a reproducible, verifiable task harness that coding agents can execute, inspect, and validate with low ambiguity.

The document-flow pilot already provides the first proof point. This roadmap extends the same operating model to the full repository across chat, plugins, auth/project scope, infrastructure, CI, and knowledge management.

## Definition of “Fully Converted”

Zeus should be considered fully converted to harness engineering when the following are all true:

1. primary engineering work happens inside reproducible harnesses rather than ad-hoc local state
2. root guidance is short and navigational, while domain knowledge lives close to the code and in dedicated docs
3. all critical product domains have seed data, doctor/bootstrap flows, and named eval suites
4. worktrees can run isolated stacks with isolated fixtures and artifacts
5. architecture boundaries and style constraints are mechanically enforced, not just documented
6. regression artifacts are durable and searchable, while debug artifacts are clearly separated and disposable
7. review, merge, and CI flows are optimized for agent execution and proof, not only human reasoning
8. entropy is actively managed as a first-class engineering concern

## Current State

Zeus already has important foundations:

- root repository guidance in `AGENTS.md`
- a large set of design and implementation plans in `docs/plans/`
- multiple git worktrees in active use
- Playwright-based browser automation
- increasing domain modularity in document flow
- owner-scoped project APIs and a clear split between `server` and `apps/app-backend`

However, the system is still incomplete as a harness-engineering platform because:

- key knowledge is still too concentrated in root-level instructions and human memory
- many regression scripts still live as debug assets rather than stable harness modules
- local environment drift remains easy, especially across `server`, `apps/app-backend`, and `apps/web`
- several high-value domains still depend on large components and route files with too much mixed responsibility
- repository-level constraints are not yet consistently enforced by automated checks
- the repository has limited entropy-governance mechanisms

## Roadmap Goals

1. Make every critical domain runnable and testable from a fresh worktree.
2. Replace ad-hoc debugging scripts with durable, named, domain-owned harnesses.
3. Move key engineering knowledge from human memory into repository-local architecture and eval docs.
4. Reduce agent context cost by restructuring large files and enforcing domain boundaries.
5. Treat observability, seed data, and artifacts as part of the engineering surface.
6. Make review and merge workflows compatible with agent-first execution.

## Non-Goals

1. This roadmap does not define customer-facing product features.
2. It does not attempt to immediately rewrite every legacy area.
3. It does not require a new monolithic “AI platform” inside Zeus.
4. It does not collapse `server` and `apps/app-backend` into one backend.
5. It does not require full autonomous engineering without human oversight.

## Strategic Principles

### 1. Harness First, Refactor Second

Every domain should gain doctor/bootstrap/seed/eval entrypoints before deep structural rewrites. Refactors without stable harnesses create churn instead of leverage.

### 2. Short Root Context, Rich Local Context

The root repository guide should become a directory layer, not a full encyclopedia. Domain architecture and eval knowledge should live in domain docs and code-adjacent guides.

### 3. Environment Drift Is a Product Bug

If `server`, `apps/app-backend`, and `apps/web` can silently read different state, the engineering system is not agent-safe. Environment doctor checks are not optional tooling; they are core product infrastructure for agent execution.

### 4. Evals Are Product Assets

Every durable eval is part of Zeus’ internal engineering product. They should be named, documented, reproducible, and mapped to domains and expected behaviors.

### 5. Entropy Must Be Budgeted

Agent-assisted repositories accumulate entropy faster than human-only ones. Debug scripts, stale AGENTS content, outdated fixtures, and obsolete route shapes must be managed proactively.

## Repository-Wide Phases

## Phase 1: Document-Flow Pilot Stabilization

This phase is already underway and serves as the proving ground for the rest of the roadmap.

### Target Outcome

- stable document-flow doctor/bootstrap/seed/eval entrypoints
- document-flow knowledge docs and harness directories
- first-pass decomposition of document page orchestration and document router segments
- documented artifact output path and regression workflow

### Exit Criteria

- document-flow regressions can be run from a fresh worktree
- document-flow seed state is deterministic enough for repeated test runs
- primary document regressions are no longer dependent on ad-hoc scripts

## Phase 2: Chat and Project-Scope Harnesses

This phase extends the same harness-first model to chat and project scope.

### Focus Areas

- chat session creation, restore, streaming, disconnect handling, and preflight inputs
- document-scoped and project-scoped chat context selection
- auth/login/refresh/project selection flows
- owner-scope correctness across personal and team routes

### Deliverables

- `tests/harness/chat/`
- `tests/harness/project-scope/`
- seed data for chat sessions and project variants
- CI-safe smoke harnesses for login + project selection + chat send/stream

### Exit Criteria

- chat and project scope regressions are reproducible from clean worktrees
- SSE-related failures can be triaged from saved artifacts rather than console guesswork

## Phase 3: Plugin Runtime Harnesses

Plugins are the next critical domain because they combine assets, install state, runtime loading, local data, and cross-domain execution.

### Focus Areas

- plugin install / enable / disable
- plugin frontend asset load
- plugin local-data semantics
- plugin route/menu/tool registration
- plugin project scope alignment
- plugin runtime fallback behavior

### Deliverables

- `tests/harness/plugins/`
- plugin-install seed/bootstrap helpers
- plugin asset existence checks
- runtime contract tests for plugin manifests and frontend entrypoints
- artifact capture for plugin load failures

### Exit Criteria

- plugin runtime failures can be diagnosed without manual reproduction
- installed/example plugin drift is tracked and checked

## Phase 4: Knowledge System Refactor

This phase restructures repository knowledge so agent work scales without enormous root prompts.

### Focus Areas

- compress root `AGENTS.md`
- introduce domain architecture docs for all major domains
- introduce eval docs for all major harness suites
- add code-adjacent guidance for large modules
- build freshness and cross-link discipline

### Deliverables

- root AGENTS rewrite
- `docs/architecture/` coverage for documents, chat, plugins, auth/project scope, deploy
- `docs/evals/` coverage for all stable harnesses
- domain-local `AGENTS.md` or equivalent runbooks where necessary

### Exit Criteria

- agents can route themselves to the right domain knowledge with low prompt overhead
- repo-local docs become the primary source of engineering truth

## Phase 5: Mechanical Enforcement Layer

This phase makes architecture and style constraints machine-enforceable.

### Focus Areas

- route-shape linting
- owner-scope correctness checks
- fixture contract validation
- domain boundary checks
- docs freshness checks
- generated schema consistency checks

### Deliverables

- repository checks for route and project-scope invariants
- fixture contract tests for each harness domain
- architecture lint rules or custom scripts for forbidden coupling patterns
- CI gates for stale or missing domain docs where appropriate

### Exit Criteria

- common architectural regressions fail automatically instead of being found in review

## Phase 6: Worktree-Native Runtime and Observability

This phase makes worktrees first-class agent execution environments.

### Focus Areas

- per-worktree port allocation
- per-worktree seed isolation or namespace partitioning
- per-worktree artifact roots
- worktree-local trace/log discovery
- environment bootstrap orchestration

### Deliverables

- standardized worktree bootstrap scripts
- deterministic mapping from worktree to runtime ports and artifact directories
- lightweight observability index for active runs
- documented cleanup/retention rules

### Exit Criteria

- engineers and agents can switch worktrees without manually untangling shared runtime state

## Phase 7: Review and Merge Workflow Transformation

This phase converts repository workflows from “agent helps a human-driven process” into “human supervises an agent-first process.”

### Focus Areas

- default review templates for spec, quality, and regression evidence
- merge readiness checks based on harness output
- PR descriptions generated from plan + evidence
- replayable artifacts attached to reviews
- standardized branch and worktree completion flow

### Deliverables

- review checklists for domain changes
- CI or local pre-merge job bundles
- repo conventions for plan -> implementation -> proof
- clear separation of debug outputs from merge evidence

### Exit Criteria

- major changes can be implemented, reviewed, and verified with agent-produced evidence as the default path

## Phase 8: Entropy Governance

This phase makes entropy management continuous rather than reactive.

### Focus Areas

- debug artifact lifecycle management
- stale harness cleanup
- deprecated guidance removal
- old route and API cleanup
- oversized file monitoring
- drift detection between example plugins and installed plugin copies

### Deliverables

- cleanup policies for `output/playwright/` and other debug surfaces
- periodic repository health checks
- file-size and complexity alerts for high-risk modules
- migration/deprecation ledger for legacy areas

### Exit Criteria

- the system gets easier to use over time instead of harder

## Knowledge Architecture End State

The target knowledge structure should look like this:

- `AGENTS.md`
  - short map of the repository
  - invariant links
  - common verification entrypoints
- `docs/architecture/`
  - per-domain architecture docs
- `docs/evals/`
  - per-domain harness documentation
- `docs/plans/`
  - feature and roadmap plans
- domain-local docs near the code
  - state models
  - route maps
  - fixture notes
  - domain warnings

The root file should point, not explain everything.

## Eval Architecture End State

Stable harnesses should be organized by domain rather than by tool:

- `tests/harness/document-flow/`
- `tests/harness/chat/`
- `tests/harness/project-scope/`
- `tests/harness/plugins/`
- `tests/harness/settings/`

Each domain should include:

- fixture docs
- API harnesses
- browser harnesses where needed
- helper modules
- stable artifact output conventions

## Observability End State

Agents should be able to answer not just “did a test pass?” but also “where did it fail?”

Desired artifact package per run:

- command metadata
- fixture metadata
- screenshots or traces when relevant
- network summary
- console summary
- domain-specific logs

This does not require a heavyweight observability platform in Phase 1, but the structure should support one later.

## Success Metrics

The conversion should be considered successful when:

1. every core domain has a doctor/bootstrap/seed/eval flow
2. root prompt size and root AGENTS dependency are significantly reduced
3. major regressions are reproducible from artifacts rather than anecdote
4. environment mismatches are detected early and automatically
5. review quality increases while setup and debugging time decrease
6. entropy indicators trend down instead of up over time

## Recommended Sequence

The recommended sequence is:

1. finish stabilizing document-flow pilot
2. extend to chat and project scope
3. extend to plugin runtime
4. restructure repository knowledge
5. add mechanical enforcement
6. make worktrees first-class runtime units
7. transform review and merge flows
8. institutionalize entropy governance

This sequence keeps each later step grounded in a working example rather than abstract policy.

## Recommendation

Proceed with full conversion only if Zeus continues to treat harnesses as the primary engineering product, not as side tooling.

The fastest path to failure would be to broaden agent usage without tightening environment, evals, and knowledge architecture. The fastest path to success is to turn each core domain into a reproducible task system, then let agent usage expand naturally on top of that substrate.
