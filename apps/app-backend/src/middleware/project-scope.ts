import type { NextFunction, Request, Response } from "express";

import { getUserId } from "./auth.js";
import {
  ProjectScopeResolverError,
  resolveProjectScopeAccess,
  type ResolvedProjectScope,
} from "./project-scope-resolver.js";

declare global {
  namespace Express {
    interface Request {
      projectScope?: ResolvedProjectScope;
    }
  }
}

function sendError(res: Response, code: string, message: string, status: number): void {
  res.status(status).json({ code, message });
}

export async function projectScopeMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await resolveProjectScopeAccess({
      userId: getUserId(req),
      ownerType: String(req.params.ownerType ?? ""),
      ownerKey: String(req.params.ownerKey ?? "").trim(),
      projectKey: String(req.params.projectKey ?? "").trim(),
      method: req.method,
    });

    req.projectScope = scope;
    req.params.ownerType = scope.ownerType;
    req.params.ownerKey = scope.ownerKey;
    req.params.projectKey = scope.scopedProjectKey;

    next();
  } catch (err) {
    if (err instanceof ProjectScopeResolverError) {
      sendError(res, err.code, err.message, err.status);
      return;
    }
    const message = err instanceof Error ? err.message : "project scope resolve failed";
    sendError(res, "PROJECT_SCOPE_RESOLVE_FAILED", message, 500);
  }
}

export type { ResolvedProjectScope } from "./project-scope-resolver.js";
