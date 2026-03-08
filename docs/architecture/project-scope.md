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

## Primary Areas

- Server: `server/internal/modules/project/`, `server/internal/modules/team/`
- App-backend: `apps/app-backend/src/middleware/project-scope.ts`, `apps/app-backend/src/middleware/project-scope-resolver.ts`, `apps/app-backend/src/project-scope.ts`
- Web: `apps/web/src/config/api.ts`, project selection state, frontend projectRef encoding and owner-scoped API builders
