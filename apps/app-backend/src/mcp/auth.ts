import type { Request } from "express";
import jwt from "jsonwebtoken";

import { getConfig, isAuthEnabled, isStandaloneMode } from "../config.js";
import type { AuthUser } from "../middleware/auth.js";

type JWTPayload = {
  user_id: string;
  email: string;
  username: string;
  token_type: "access" | "refresh";
  iss: string;
  exp: number;
  iat: number;
};

export class McpAuthError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "McpAuthError";
    this.code = code;
    this.status = status;
  }
}

function defaultUser(): AuthUser {
  const config = getConfig();
  return {
    id: config.defaultUserId,
    email: "default@local",
    username: "default",
  };
}

function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(" ");
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    return null;
  }
  return token;
}

function verifyAccessToken(token: string, secret: string): JWTPayload | null {
  try {
    const payload = jwt.verify(token, secret) as JWTPayload;
    if (payload.token_type !== "access") {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function resolveMcpUser(req: Request, requireAuth: boolean): AuthUser {
  if (isStandaloneMode() || !isAuthEnabled()) {
    return defaultUser();
  }

  const token = extractToken(req);
  if (!token) {
    if (requireAuth) {
      throw new McpAuthError("UNAUTHORIZED", "Missing or invalid authorization header", 401);
    }
    return defaultUser();
  }

  const jwtSecret = getConfig().auth.jwtSecret;
  if (!jwtSecret) {
    throw new McpAuthError("INTERNAL_ERROR", "Authentication is not properly configured", 500);
  }

  const payload = verifyAccessToken(token, jwtSecret);
  if (!payload) {
    throw new McpAuthError("INVALID_TOKEN", "Invalid or expired token", 401);
  }

  return {
    id: payload.user_id,
    email: payload.email,
    username: payload.username,
  };
}
