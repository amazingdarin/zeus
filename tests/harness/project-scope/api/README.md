# Project Scope API Harness

This directory contains API-level auth and owner-scope checks.

The coverage is split into two layers:

- personal owner-scope baseline
- team role matrix behavior

Current entrypoints:

- `auth-smoke.mjs`
- `personal-scope.mjs`
- `personal-valid.mjs`
- `personal-invalid-owner.mjs`
- `personal-cross-user-denied.mjs`
- `project-ref-roundtrip.mjs`
- `team-read-matrix.mjs`
- `team-write-matrix.mjs`
- `team-outsider-denied.mjs`
- `team-project-ref-roundtrip.mjs`

Team-scope harnesses require seeded team identities and fixtures:

```bash
npm run seed:project-scope
```

The team API harnesses are the primary permission proof layer. Browser harnesses only verify frontend `projectRef` path round-trip behavior.
