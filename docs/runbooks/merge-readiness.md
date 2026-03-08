# Merge Readiness

Use this runbook before merging changes in Zeus.

## Merge Readiness Checklist

1. the relevant domain harnesses have been executed recently
2. the change has a documented fixture or seed assumption when needed
3. known warnings or blockers are called out explicitly
4. generated or debug-only artifacts are not accidentally staged
5. the branch contains the minimum documentation updates for any new harness or domain rule

## Default Evidence Order

- unit or contract tests
- domain harnesses
- browser regression harnesses
- build output
- environment doctor output when relevant

## Rule

A branch is not merge-ready just because code compiles. It must also prove the expected behavior through the appropriate harness entrypoints.
