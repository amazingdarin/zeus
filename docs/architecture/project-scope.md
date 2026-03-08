# Project Scope Architecture

Project scope is the boundary layer that keeps personal and team-owned resources isolated across the Zeus stack.

The Go `server` owns project records and owner membership checks. The TypeScript `app-backend` enforces scoped project access through middleware and owner/project resolution. Any feature that reads project-scoped data must respect this layer instead of bypassing it in the client.

## Personal Owner Scope

The personal owner scope is the base contract for all project-scoped harnesses. Frontend `projectRef` values such as `personal::me::<project>` must round-trip into backend owner/project routing without ambiguity.

This is why project-scope harnessing starts with:
- valid `personal::me::<project>` behavior
- invalid owner key rejection
- explicit cross-user personal scope rejection
- a frontend projectRef browser round-trip harness

## Team Role Matrix

The second layer extends the same project-scope harness shape into a team role matrix.

The current matrix verifies:
- read access for `owner`, `admin`, `member`, and `viewer`
- write access for `owner`, `admin`, and `member`
- write denial for `viewer`
- read and write denial for outsider identities
- frontend team `projectRef` browser round-trip behavior

## Seeded Storage Constraint

One implementation detail matters for harness design: app-backend document storage is still rooted by the authenticated user even for team-scoped projects.

That means team matrix seed data cannot rely on a single shared write-probe document created by the owner account. The project-scope seed layer must provision the write probe document for each writable role account that exercises write-gated routes.

The project-scope harnesses treat this as an environment contract, not as a permission rule change.

## Primary Areas

- Server: `server/internal/modules/project/`, `server/internal/modules/team/`
- App-backend: `apps/app-backend/src/middleware/project-scope.ts`, `apps/app-backend/src/middleware/project-scope-resolver.ts`, `apps/app-backend/src/project-scope.ts`, `apps/app-backend/src/storage/paths.ts`
- Web: `apps/web/src/config/api.ts`, project selection state, frontend projectRef encoding and owner-scoped API builders
