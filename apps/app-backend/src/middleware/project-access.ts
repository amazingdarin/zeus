import { Request, Response, NextFunction } from 'express';
import { getConfig, isProjectIsolationEnabled, isStandaloneMode } from '../config.js';
import { getUserId } from './auth.js';

/**
 * Project access control middleware
 * In multi-tenant mode, verifies that the user has access to the requested project
 * In standalone mode, allows all access
 */
export function projectAccessMiddleware(req: Request, res: Response, next: NextFunction) {
  // Skip access control in standalone mode
  if (isStandaloneMode() || !isProjectIsolationEnabled()) {
    return next();
  }
  
  const projectKey = req.params.projectKey;
  if (!projectKey) {
    return next();
  }
  
  const userId = getUserId(req);
  
  // In a full implementation, this would:
  // 1. Look up the project by key
  // 2. Check if the user is the owner or a team member
  // 3. Check project visibility settings
  
  // For now, we'll implement a simple check that can be expanded later
  // The actual access control will be handled by the Go server in multi-tenant mode
  
  // TODO: Implement full project access control
  // For now, allow access if user is authenticated
  if (!userId) {
    return res.status(403).json({
      code: 'FORBIDDEN',
      message: 'Access denied to this project',
    });
  }
  
  next();
}

/**
 * Check if user can access a project (to be used in handlers)
 * @param userId User ID
 * @param projectKey Project key
 * @returns true if user can access the project
 */
export async function canAccessProject(userId: string, projectKey: string): Promise<boolean> {
  // In standalone mode, always allow
  if (isStandaloneMode() || !isProjectIsolationEnabled()) {
    return true;
  }
  
  // In multi-tenant mode, the Go server handles access control
  // This function can be expanded to cache access checks or make API calls
  
  // For now, return true (access control is handled at the API gateway level)
  return true;
}

/**
 * Check if user can modify a project
 * @param userId User ID  
 * @param projectKey Project key
 * @returns true if user can modify the project
 */
export async function canModifyProject(userId: string, projectKey: string): Promise<boolean> {
  // In standalone mode, always allow
  if (isStandaloneMode() || !isProjectIsolationEnabled()) {
    return true;
  }
  
  // In multi-tenant mode, only owners and admins can modify
  // This would need to check the user's role in the project/team
  
  // For now, return true if user can access
  return canAccessProject(userId, projectKey);
}
