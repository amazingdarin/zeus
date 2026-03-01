import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getConfig, isAuthEnabled, isStandaloneMode } from '../config.js';

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

type ResolveAuthUserOptions = {
  jwtSecret?: string;
  authServerUrl?: string;
};

type ResolveAuthUserDeps = {
  fetchFn?: typeof fetch;
  now?: () => number;
};

type CachedAuthUserValue = {
  user: AuthUser | null;
  expiresAt: number;
};

const AUTH_USER_CACHE_TTL_MS = 30_000;
const authUserCache = new Map<string, CachedAuthUserValue>();

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

function normalizeServerBaseUrl(value: string | undefined): string {
  return String(value ?? '').trim().replace(/\/+$/, '');
}

function mapJwtPayloadToUser(payload: JWTPayload): AuthUser {
  return {
    id: payload.user_id,
    email: payload.email,
    username: payload.username,
  };
}

function getDefaultUser(config: ReturnType<typeof getConfig>): AuthUser {
  return {
    id: config.defaultUserId,
    email: 'default@local',
    username: 'default',
  };
}

function readCachedAuthUser(cacheKey: string, now: number): AuthUser | null | undefined {
  const cached = authUserCache.get(cacheKey);
  if (!cached) {
    return undefined;
  }
  if (cached.expiresAt <= now) {
    authUserCache.delete(cacheKey);
    return undefined;
  }
  return cached.user;
}

function writeCachedAuthUser(cacheKey: string, now: number, user: AuthUser | null): void {
  authUserCache.set(cacheKey, {
    user,
    expiresAt: now + AUTH_USER_CACHE_TTL_MS,
  });
}

export function resetAuthUserResolutionCacheForTests(): void {
  authUserCache.clear();
}

export async function resolveAuthUserFromToken(
  token: string,
  options: ResolveAuthUserOptions,
  deps?: ResolveAuthUserDeps,
): Promise<AuthUser | null> {
  const normalizedToken = String(token ?? '').trim();
  if (!normalizedToken) {
    return null;
  }

  const jwtSecret = String(options.jwtSecret ?? '').trim();
  if (jwtSecret) {
    const payload = validateToken(normalizedToken, jwtSecret);
    if (payload) {
      return mapJwtPayloadToUser(payload);
    }
  }

  const authServerBase = normalizeServerBaseUrl(options.authServerUrl);
  if (!authServerBase) {
    return null;
  }

  const now = deps?.now ? deps.now() : Date.now();
  const cacheKey = `${authServerBase}::${normalizedToken}`;
  const cached = readCachedAuthUser(cacheKey, now);
  if (cached !== undefined) {
    return cached;
  }

  const fetchFn = deps?.fetchFn ?? fetch;

  try {
    const response = await fetchFn(`${authServerBase}/api/auth/me`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${normalizedToken}`,
      },
    });

    if (!response.ok) {
      writeCachedAuthUser(cacheKey, now, null);
      return null;
    }

    const payload = await response.json().catch(() => null);
    const data = payload?.data ?? payload ?? {};
    const id = String(data?.id ?? data?.user_id ?? '').trim();
    if (!id) {
      writeCachedAuthUser(cacheKey, now, null);
      return null;
    }

    const user: AuthUser = {
      id,
      email: String(data?.email ?? '').trim(),
      username: String(data?.username ?? '').trim(),
    };
    writeCachedAuthUser(cacheKey, now, user);
    return user;
  } catch {
    return null;
  }
}

function applyStandaloneUser(
  req: Request,
  next: NextFunction,
  token: string | null,
  config: ReturnType<typeof getConfig>,
): void {
  const fallbackUser = getDefaultUser(config);
  if (!token) {
    req.user = fallbackUser;
    next();
    return;
  }

  void resolveAuthUserFromToken(token, {
    jwtSecret: config.auth.jwtSecret,
    authServerUrl: config.auth.serverUrl,
  })
    .then((resolvedUser) => {
      req.user = resolvedUser ?? fallbackUser;
      next();
    })
    .catch(() => {
      req.user = fallbackUser;
      next();
    });
}

/**
 * Authentication middleware
 * - In standalone mode: Uses default user, no token required
 * - In multi-tenant mode: Validates JWT token
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const config = getConfig();
  const token = extractToken(req);
  
  // Standalone mode - use default user
  if (isStandaloneMode() || !isAuthEnabled()) {
    applyStandaloneUser(req, next, token, config);
    return;
  }
  
  // Multi-tenant mode - validate JWT
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
  const token = extractToken(req);
  
  // Standalone mode - use default user
  if (isStandaloneMode() || !isAuthEnabled()) {
    applyStandaloneUser(req, next, token, config);
    return;
  }
  
  // Try to extract and validate token
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
