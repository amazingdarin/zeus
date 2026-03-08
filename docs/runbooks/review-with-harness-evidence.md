# Review With Harness Evidence

Use this runbook when reviewing agent-driven or engineer-driven changes in Zeus.

## Required Evidence

Reviewers should ask for evidence in this order:

1. which harness or test command proves the change
2. what fixture or seeded project was used
3. where the artifacts are stored
4. whether the result is a domain-level smoke check or a deeper regression run

## Minimum Review Template

- Scope: which domain changed
- Commands: exact commands executed
- Results: pass/fail counts and key assertions
- Artifacts: output directory, screenshots, console summaries, API output
- Residual risks: known warnings, skipped suites, environment blockers

## Rule

Do not accept “manually checked” as the only form of proof for harness-covered domains.
