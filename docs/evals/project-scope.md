# Project Scope Evals

Project-scope evals verify that auth and owner-scoped access rules are enforced consistently across server and app-backend layers.

## Current Entry Points

- `npm run eval:project-scope:api`

## Expected Coverage Growth

The current skeleton validates login, personal project listing, and invalid owner rejection. It should later add team-scope fixtures, permission matrix checks, and cross-service environment consistency verification.
