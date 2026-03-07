import { query } from "../db/postgres.js";
import {
  buildScopedProjectKey,
  normalizeOwnerType,
  toDbOwnerType,
  type ProjectOwnerType,
} from "../project-scope.js";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

type TeamOwnerRow = {
  id: string;
  slug: string;
  role: string | null;
};

type ProjectRow = {
  id: string;
};

export type ResolvedProjectScope = {
  ownerType: ProjectOwnerType;
  ownerKey: string;
  ownerId: string;
  projectKey: string;
  scopedProjectKey: string;
  projectId: string;
  canRead: boolean;
  canWrite: boolean;
};

export type ResolveProjectScopeInput = {
  userId: string;
  ownerType: string;
  ownerKey: string;
  projectKey: string;
  method?: string;
  requireWrite?: boolean;
};

export class ProjectScopeResolverError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ProjectScopeResolverError";
    this.code = code;
    this.status = status;
  }
}

type QueryLike = (
  sql: string,
  params?: unknown[],
) => Promise<{ rows: Record<string, unknown>[] }>;

function isWriteMethod(method: string): boolean {
  return WRITE_METHODS.has(String(method ?? "").trim().toUpperCase());
}

function canTeamRoleWrite(role: string): boolean {
  const normalized = String(role ?? "").trim().toLowerCase();
  return normalized === "owner" || normalized === "admin" || normalized === "member";
}

function asResolverError(err: unknown): ProjectScopeResolverError {
  if (err instanceof ProjectScopeResolverError) {
    return err;
  }
  const message = err instanceof Error ? err.message : "project scope resolve failed";
  return new ProjectScopeResolverError("PROJECT_SCOPE_RESOLVE_FAILED", message, 500);
}

export function createProjectScopeResolver(deps?: { queryFn?: QueryLike }) {
  const queryFn: QueryLike = deps?.queryFn ?? (query as unknown as QueryLike);

  return async function resolveProjectScope(
    input: ResolveProjectScopeInput,
  ): Promise<ResolvedProjectScope> {
    try {
      const userId = String(input.userId ?? "").trim();
      if (!userId) {
        throw new ProjectScopeResolverError("UNAUTHORIZED", "user not authenticated", 401);
      }

      const ownerType = normalizeOwnerType(input.ownerType);
      const ownerKeyRaw = String(input.ownerKey ?? "").trim();
      const projectKeyRaw = String(input.projectKey ?? "").trim();

      if (!ownerType) {
        throw new ProjectScopeResolverError("INVALID_OWNER", "invalid owner_type", 400);
      }
      if (!ownerKeyRaw) {
        throw new ProjectScopeResolverError("INVALID_OWNER", "owner_key is required", 400);
      }
      if (!projectKeyRaw) {
        throw new ProjectScopeResolverError("INVALID_PROJECT_KEY", "project_key is required", 400);
      }

      let ownerId = "";
      let ownerKey = "";
      let canRead = false;
      let canWrite = false;

      if (ownerType === "personal") {
        const normalizedOwnerKey = ownerKeyRaw.toLowerCase();
        if (normalizedOwnerKey !== "me" && normalizedOwnerKey !== userId.toLowerCase()) {
          throw new ProjectScopeResolverError("INVALID_OWNER", "invalid personal owner_key", 400);
        }
        ownerId = userId;
        ownerKey = "me";
        canRead = true;
        canWrite = true;
      } else {
        const teamResult = await queryFn(
          `SELECT t.id, t.slug, tm.role
             FROM team t
             LEFT JOIN team_member tm
               ON tm.team_id = t.id AND tm.user_id = $2
            WHERE (t.slug = $1 OR t.id = $1) AND t.status = 'active'
            LIMIT 1`,
          [ownerKeyRaw, userId],
        );
        const row = teamResult.rows[0] as TeamOwnerRow | undefined;
        if (!row) {
          throw new ProjectScopeResolverError("PROJECT_NOT_FOUND", "project not found", 404);
        }
        if (!row.role) {
          throw new ProjectScopeResolverError("PROJECT_ACCESS_DENIED", "access denied", 403);
        }
        ownerId = row.id;
        ownerKey = row.slug;
        canRead = true;
        canWrite = canTeamRoleWrite(row.role);
      }

      const dbOwnerType = toDbOwnerType(ownerType);
      const projectResult = await queryFn(
        `SELECT id
           FROM project
          WHERE key = $1 AND owner_type = $2 AND owner_id = $3
          LIMIT 1`,
        [projectKeyRaw, dbOwnerType, ownerId],
      );
      const project = projectResult.rows[0] as ProjectRow | undefined;
      if (!project) {
        throw new ProjectScopeResolverError("PROJECT_NOT_FOUND", "project not found", 404);
      }

      const scope: ResolvedProjectScope = {
        ownerType,
        ownerKey,
        ownerId,
        projectKey: projectKeyRaw,
        scopedProjectKey: buildScopedProjectKey({
          ownerType,
          ownerId,
          projectKey: projectKeyRaw,
        }),
        projectId: project.id,
        canRead,
        canWrite,
      };

      const requiresWrite = input.requireWrite === true || isWriteMethod(input.method ?? "");
      if (requiresWrite && !scope.canWrite) {
        throw new ProjectScopeResolverError("PROJECT_ACCESS_DENIED", "insufficient permission", 403);
      }

      return scope;
    } catch (err) {
      throw asResolverError(err);
    }
  };
}

const resolveProjectScope = createProjectScopeResolver();

export async function resolveProjectScopeAccess(
  input: ResolveProjectScopeInput,
): Promise<ResolvedProjectScope> {
  return resolveProjectScope(input);
}
