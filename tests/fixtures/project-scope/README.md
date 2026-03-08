# Project Scope Fixtures

This directory documents the auth and owner-scope assumptions used by harnesses.

## Personal Scope Fixture

`personal.json` defines the baseline personal owner-scope contract used by the first behavior-level harnesses.

Fields:

- `ownerType`: currently `personal`
- `ownerKey`: the frontend shorthand owner key, currently `me`
- `projectKey`: the primary personal project used for valid owner-scope checks
- `alternateProjectKey`: a second project key owned by the same user for equivalence checks
- `invalidOwnerKey`: a non-current-user owner key used for rejection tests

The first project-scope behavior harnesses validate `personal::me::<project>` success, explicit invalid owner rejection, and projectRef/backend round-trip consistency.

## Team Scope Fixture

`team.json` extends the same contract shape into a team role matrix.

Fields:

- `ownerType`: currently `team`
- `ownerKey`: the stable team slug used for team-scope harnesses
- `projectKey`: the stable team project used by role-matrix checks
- `writeProbeDocId`: the low-noise document id used for write-gated lock probes
- `roles`: account registry keys for `owner`, `admin`, `member`, `viewer`, and `outsider`

The role entries do not embed live credentials. They point at seeded automation identities that will be resolved through the shared Playwright account storage and the project-scope seed output.

The intended harness order is:

1. personal owner-scope baseline
2. team role matrix expansion

That keeps project-scope behavior deterministic before chat, plugin, or broader UI harnesses build on it.
