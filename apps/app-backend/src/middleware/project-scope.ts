import type { NextFunction, Request, Response } from "express";

import { query } from "../db/postgres.js";
import {
  buildScopedProjectKey,
  normalizeOwnerType,
  toDbOwnerType,
  type ProjectOwnerType,
} from "../project-scope.js";
import { getUserId } from "./auth.js";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

type TeamOwnerRow = {
  id: string;
  slug: string;
  name: string;
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

declare global {
  namespace Express {
    interface Request {
      projectScope?: ResolvedProjectScope;
    }
  }
}

function isWriteMethod(method: string): boolean {
  return WRITE_METHODS.has(String(method ?? "").trim().toUpperCase());
}

function canTeamRoleWrite(role: string): boolean {
  const normalized = String(role ?? "").trim().toLowerCase();
  return normalized === "owner" || normalized === "admin" || normalized === "member";
}

function sendError(res: Response, code: string, message: string, status: number): void {
  res.status(status).json({ code, message });
}

async function resolvePersonalScope(userId: string, ownerKey: string) {
  const normalizedOwnerKey = String(ownerKey ?? "").trim().toLowerCase();
  if (normalizedOwnerKey !== "me" && normalizedOwnerKey !== String(userId ?? "").trim().toLowerCase()) {
    return { ok: false as const, code: "INVALID_OWNER", message: "invalid personal owner_key", status: 400 };
  }

  return {
    ok: true as const,
    ownerType: "personal" as const,
    ownerKey: "me",
    ownerId: userId,
    canRead: true,
    canWrite: true,
  };
}

async function resolveTeamScope(userId: string, ownerKey: string) {
  const teamSlug = String(ownerKey ?? "").trim();
  if (!teamSlug) {
    return { ok: false as const, code: "INVALID_OWNER", message: "owner_key is required for team", status: 400 };
  }

  const teamResult = await query<TeamOwnerRow>(
    `SELECT t.id, t.slug, t.name, tm.role
       FROM team t
       LEFT JOIN team_member tm
         ON tm.team_id = t.id AND tm.user_id = $2
      WHERE (t.slug = $1 OR t.id = $1) AND t.status = 'active'
      LIMIT 1`,
    [teamSlug, userId],
  );

  if (!teamResult.rows[0]) {
    return { ok: false as const, code: "PROJECT_NOT_FOUND", message: "project not found", status: 404 };
  }

  const row = teamResult.rows[0];
  if (!row.role) {
    return { ok: false as const, code: "PROJECT_ACCESS_DENIED", message: "access denied", status: 403 };
  }

  return {
    ok: true as const,
    ownerType: "team" as const,
    ownerKey: row.slug,
    ownerId: row.id,
    canRead: true,
    canWrite: canTeamRoleWrite(row.role),
  };
}

export async function projectScopeMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = getUserId(req);
    if (!userId) {
      sendError(res, "UNAUTHORIZED", "user not authenticated", 401);
      return;
    }

    const ownerTypeRaw = String(req.params.ownerType ?? "");
    const ownerType = normalizeOwnerType(ownerTypeRaw);
    const ownerKeyRaw = String(req.params.ownerKey ?? "").trim();
    const projectKeyRaw = String(req.params.projectKey ?? "").trim();

    if (!ownerType) {
      sendError(res, "INVALID_OWNER", "invalid owner_type", 400);
      return;
    }
    if (!ownerKeyRaw) {
      sendError(res, "INVALID_OWNER", "owner_key is required", 400);
      return;
    }
    if (!projectKeyRaw) {
      sendError(res, "INVALID_PROJECT_KEY", "project_key is required", 400);
      return;
    }

    const ownerResult =
      ownerType === "personal"
        ? await resolvePersonalScope(userId, ownerKeyRaw)
        : await resolveTeamScope(userId, ownerKeyRaw);

    if (!ownerResult.ok) {
      sendError(res, ownerResult.code, ownerResult.message, ownerResult.status);
      return;
    }

    const dbOwnerType = toDbOwnerType(ownerResult.ownerType);
    const projectResult = await query<ProjectRow>(
      `SELECT id
         FROM project
        WHERE key = $1 AND owner_type = $2 AND owner_id = $3
        LIMIT 1`,
      [projectKeyRaw, dbOwnerType, ownerResult.ownerId],
    );

    const projectRow = projectResult.rows[0];
    if (!projectRow) {
      sendError(res, "PROJECT_NOT_FOUND", "project not found", 404);
      return;
    }

    const scope: ResolvedProjectScope = {
      ownerType: ownerResult.ownerType,
      ownerKey: ownerResult.ownerKey,
      ownerId: ownerResult.ownerId,
      projectKey: projectKeyRaw,
      scopedProjectKey: buildScopedProjectKey({
        ownerType: ownerResult.ownerType,
        ownerId: ownerResult.ownerId,
        projectKey: projectKeyRaw,
      }),
      projectId: projectRow.id,
      canRead: ownerResult.canRead,
      canWrite: ownerResult.canWrite,
    };

    if (isWriteMethod(req.method) && !scope.canWrite) {
      sendError(res, "PROJECT_ACCESS_DENIED", "insufficient permission", 403);
      return;
    }

    req.projectScope = scope;
    req.params.ownerType = scope.ownerType;
    req.params.ownerKey = scope.ownerKey;
    req.params.projectKey = scope.scopedProjectKey;

    next();
  } catch (err) {
    const message = err instanceof Error ? err.message : "project scope resolve failed";
    sendError(res, "PROJECT_SCOPE_RESOLVE_FAILED", message, 500);
  }
}
