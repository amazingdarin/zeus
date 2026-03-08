# Eval Index

This directory is the eval and harness entrypoint for Zeus.

Use these docs to discover stable harness suites, seed requirements, command entrypoints, and expected artifacts before running or modifying regressions.

## Current Eval Docs

- `document-flow.md`: doctor, seed, reset, Playwright harnesses, API harnesses, and artifact rules for the document flow pilot.
- `chat.md`: planned chat harness and eval index.
- `project-scope.md`: planned auth and owner-scope harness index.
- `plugins.md`: planned plugin runtime harness index.

## Usage Rule

Root `AGENTS.md` should point here for regression discovery. Stable harnesses belong under `tests/harness/<domain>/`, while ad-hoc debugging scripts remain outside the eval index unless they are promoted into durable checks.
