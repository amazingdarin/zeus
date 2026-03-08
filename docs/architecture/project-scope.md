# Project Scope Architecture

Project scope is the boundary layer that keeps personal and team-owned resources isolated across the Zeus stack.

The Go `server` owns project records and owner membership checks. The TypeScript `app-backend` enforces scoped project access through middleware and owner/project resolution. Any feature that reads project-scoped data must respect this layer instead of bypassing it in the client.

## Primary Areas

- Server: `server/internal/modules/project/`, `server/internal/modules/team/`
- App-backend: `apps/app-backend/src/middleware/project-scope.ts`, `apps/app-backend/src/middleware/project-scope-resolver.ts`, `apps/app-backend/src/project-scope.ts`
- Web: `apps/web/src/config/api.ts`, project selection state, owner-scoped API builders
