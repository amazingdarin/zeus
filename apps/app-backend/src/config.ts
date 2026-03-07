/**
 * Application configuration for Zeus app-backend
 * Supports both standalone (single-user) and multi-tenant modes
 */

export type AppMode = 'standalone' | 'multi-tenant';

export interface AuthConfig {
  enabled: boolean;
  jwtSecret?: string;
  /** URL of the Go server for token validation in multi-tenant mode */
  serverUrl?: string;
}

export interface ProjectIsolationConfig {
  enabled: boolean;
}

export interface AppConfig {
  mode: AppMode;
  auth: AuthConfig;
  projectIsolation: ProjectIsolationConfig;
  /** Default user ID for standalone mode */
  defaultUserId: string;
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === '') return defaultValue;
  return value.toLowerCase() === 'true' || value === '1';
}

export function loadConfig(): AppConfig {
  const mode = (process.env.APP_MODE as AppMode) || 'standalone';
  const isMultiTenant = mode === 'multi-tenant';

  return {
    mode,
    auth: {
      enabled: parseBoolean(process.env.AUTH_ENABLED, isMultiTenant),
      jwtSecret: process.env.JWT_SECRET,
      serverUrl: process.env.AUTH_SERVER_URL || 'http://localhost:8080',
    },
    projectIsolation: {
      enabled: parseBoolean(process.env.PROJECT_ISOLATION, isMultiTenant),
    },
    defaultUserId: process.env.DEFAULT_USER_ID || 'default-user',
  };
}

// Singleton config instance
let config: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (!config) {
    config = loadConfig();
  }
  return config;
}

export function isStandaloneMode(): boolean {
  return getConfig().mode === 'standalone';
}

export function isMultiTenantMode(): boolean {
  return getConfig().mode === 'multi-tenant';
}

export function isAuthEnabled(): boolean {
  return getConfig().auth.enabled;
}

export function isProjectIsolationEnabled(): boolean {
  return getConfig().projectIsolation.enabled;
}
