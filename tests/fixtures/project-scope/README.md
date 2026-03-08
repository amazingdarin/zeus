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

The first project-scope behavior harnesses should validate `personal::me::<project>` success, explicit invalid owner rejection, and projectRef/backend round-trip consistency before team-role fixtures are added.
