import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getConfig, isAuthEnabled, isStandaloneMode } from '../config';

export interface AuthUser {
  id: string;
  email: string;
  username: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

interface JWTPayload {
  user_id: string;
  email: string;
  username: string;
  token_type: 'access' | 'refresh';
  iss: string;
  exp: number;
  iat: number;
}

/**
 * Extract Bearer token from Authorization header
 */
function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return null;
  }
  
  return parts[1];
}

/**
 * Validate JWT token and return payload
 */
function validateToken(token: string, secret: string): JWTPayload | null {
  try {
    const payload = jwt.verify(token, secret) as JWTPayload;
    
    // Only accept access tokens
    if (payload.token_type !== 'access') {
      return null;
    }
    
    return payload;
  } catch (error) {
    return null;
  }
}

/**
 * Authentication middleware
 * - In standalone mode: Uses default user, no token required
 * - In multi-tenant mode: Validates JWT token
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const config = getConfig();
  
  // Standalone mode - use default user
  if (isStandaloneMode() || !isAuthEnabled()) {
    req.user = {
      id: config.defaultUserId,
      email: 'default@local',
      username: 'default',
    };
    return next();
  }
  
  // Multi-tenant mode - validate JWT
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({
      code: 'UNAUTHORIZED',
      message: 'Missing or invalid authorization header',
    });
  }
  
  const jwtSecret = config.auth.jwtSecret;
  if (!jwtSecret) {
    console.error('JWT_SECRET is not configured');
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'Authentication is not properly configured',
    });
  }
  
  const payload = validateToken(token, jwtSecret);
  if (!payload) {
    return res.status(401).json({
      code: 'INVALID_TOKEN',
      message: 'Invalid or expired token',
    });
  }
  
  req.user = {
    id: payload.user_id,
    email: payload.email,
    username: payload.username,
  };
  
  next();
}

/**
 * Optional authentication middleware
 * Sets user if token is present and valid, but doesn't require it
 */
export function optionalAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const config = getConfig();
  
  // Standalone mode - use default user
  if (isStandaloneMode() || !isAuthEnabled()) {
    req.user = {
      id: config.defaultUserId,
      email: 'default@local',
      username: 'default',
    };
    return next();
  }
  
  // Try to extract and validate token
  const token = extractToken(req);
  if (token && config.auth.jwtSecret) {
    const payload = validateToken(token, config.auth.jwtSecret);
    if (payload) {
      req.user = {
        id: payload.user_id,
        email: payload.email,
        username: payload.username,
      };
    }
  }
  
  next();
}

/**
 * Get current user from request
 * Throws if user is not authenticated
 */
export function requireUser(req: Request): AuthUser {
  if (!req.user) {
    throw new Error('User not authenticated');
  }
  return req.user;
}

/**
 * Get current user ID from request
 * Returns default user ID if in standalone mode or not authenticated
 */
export function getUserId(req: Request): string {
  return req.user?.id ?? getConfig().defaultUserId;
}
