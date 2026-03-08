# Project Scope Playwright Harness

This directory contains browser-level project-scope regressions.

Current browser coverage is limited to frontend `projectRef` round-trip alignment:

- `personal-project-ref.mjs`: validates `personal::me::<project>` path resolution
- `team-project-ref.mjs`: validates `team::<ownerKey>::<project>` path resolution

These harnesses are not the primary permission proof layer. Role-based allow/deny behavior remains covered by the API harnesses under `tests/harness/project-scope/api/`.
