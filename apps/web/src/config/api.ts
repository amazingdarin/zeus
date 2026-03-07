import { getLocaleRequestHeaders, resolveRequestLocale } from "../i18n/request-locale";
const env = (((import.meta as unknown as { env?: Record<string, unknown> }).env ?? {}) as Record<string, unknown>);
const apiBaseUrl = String(env.VITE_API_BASE_URL ?? "").trim();
const appBackendUrl = String(env.VITE_APP_BACKEND_URL ?? "http://localhost:4870").trim();
const serverUrl = String(env.VITE_SERVER_URL ?? "http://localhost:8080").trim();
const remoteKnowledgeBaseUrl = (
  env.VITE_REMOTE_KNOWLEDGE_BASE_URL
  ?? env.VITE_REMOTE_APP_BACKEND_URL
  ?? ""
).toString().trim();
const useProxy = Boolean(env.DEV);
const remoteKnowledgeBaseStorageKey = "zeus.settings.use_remote_knowledge_base";

const PROJECT_REF_SEPARATOR = "::";

export type ProjectRefOwnerType = "personal" | "team";

export type ParsedProjectRef = {
  ownerType: ProjectRefOwnerType;
  ownerKey: string;
  projectKey: string;
};

/**
 * Get the Go server URL for auth and management APIs
 */
export const getServerUrl = (): string => {
  if (useProxy || !serverUrl) {
    return "";
  }
  return serverUrl;
};

export const buildProjectRef = (parts: ParsedProjectRef): string => {
  const ownerType = parts.ownerType === "team" ? "team" : "personal";
  const ownerKey = String(parts.ownerKey ?? "").trim() || "me";
  const projectKey = String(parts.projectKey ?? "").trim();
  return `${ownerType}${PROJECT_REF_SEPARATOR}${ownerKey}${PROJECT_REF_SEPARATOR}${projectKey}`;
};

export const parseProjectRef = (projectRef: string): ParsedProjectRef => {
  const raw = String(projectRef ?? "").trim();
  if (!raw) {
    return { ownerType: "personal", ownerKey: "me", projectKey: "" };
  }

  const parts = raw.split(PROJECT_REF_SEPARATOR);
  if (parts.length === 3) {
    const ownerType = String(parts[0] ?? "").trim().toLowerCase() === "team" ? "team" : "personal";
    const ownerKey = String(parts[1] ?? "").trim() || (ownerType === "personal" ? "me" : "");
    const projectKey = String(parts[2] ?? "").trim();
    return { ownerType, ownerKey, projectKey };
  }

  return { ownerType: "personal", ownerKey: "me", projectKey: raw };
};

export const encodeProjectRef = (projectRef: string): string => {
  const parsed = parseProjectRef(projectRef);
  return `${encodeURIComponent(parsed.ownerType)}/${encodeURIComponent(parsed.ownerKey)}/${encodeURIComponent(parsed.projectKey)}`;
};

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");
const trimLeadingSlash = (value: string) => value.replace(/^\/+/, "");
let remoteKnowledgeBaseEnabledCache: boolean | null = null;

function readRemoteKnowledgeBaseEnabledFromStorage(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return window.localStorage.getItem(remoteKnowledgeBaseStorageKey) === "1";
  } catch {
    return false;
  }
}

export function isRemoteKnowledgeBaseEnabled(): boolean {
  if (remoteKnowledgeBaseEnabledCache != null) {
    return remoteKnowledgeBaseEnabledCache;
  }
  remoteKnowledgeBaseEnabledCache = readRemoteKnowledgeBaseEnabledFromStorage();
  return remoteKnowledgeBaseEnabledCache;
}

export function setRemoteKnowledgeBaseEnabled(enabled: boolean): void {
  remoteKnowledgeBaseEnabledCache = enabled;
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(remoteKnowledgeBaseStorageKey, enabled ? "1" : "0");
  } catch {
    // Ignore storage failures.
  }
}

export function getRemoteKnowledgeBaseBackendUrl(): string {
  return remoteKnowledgeBaseUrl;
}

const isScopedProjectPath = (path: string): boolean => {
  return /^\/api\/projects\/[^/]+\/[^/]+\/[^/]+(?:\/|$)/.test(path);
};

/**
 * Check if a path should be routed to app-backend
 */
const isAppBackendPath = (path: string): boolean => {
  if (path.startsWith("/api/app")) return true;

  if (isScopedProjectPath(path)) return true;
  if (path.startsWith("/api/system-docs")) return true;

  if (path.startsWith("/api/plugins")) return true;
  if (path.startsWith("/api/skills")) return true;
  if (path.startsWith("/api/llm/")) return true;
  if (path.startsWith("/api/settings/")) return true;
  return false;
};

const isKnowledgeBasePath = (path: string): boolean => {
  if (isScopedProjectPath(path)) return true;
  if (path.startsWith("/api/system-docs")) return true;
  return false;
};

export const buildApiUrl = (path: string) => {
  const normalizedPath = `/${trimLeadingSlash(path)}`;

  if (isAppBackendPath(normalizedPath)) {
    const appPath = normalizedPath.startsWith("/api/app")
      ? normalizedPath.replace("/api/app", "/api")
      : normalizedPath;
    if (useProxy) {
      return appPath;
    }
    const shouldUseRemoteKnowledgeBase = Boolean(
      remoteKnowledgeBaseUrl
      && isRemoteKnowledgeBaseEnabled()
      && isKnowledgeBasePath(appPath),
    );
    const targetBaseUrl = shouldUseRemoteKnowledgeBase
      ? remoteKnowledgeBaseUrl
      : appBackendUrl;
    return `${trimTrailingSlash(targetBaseUrl)}${appPath}`;
  }

  if (useProxy || !apiBaseUrl) {
    return normalizedPath;
  }
  return `${trimTrailingSlash(apiBaseUrl)}${normalizedPath}`;
};

const getAccessToken = (): string | null => {
  return localStorage.getItem("zeus_access_token");
};


const fetchWithCredentials = (path: string, init: RequestInit = {}) => {
  const token = getAccessToken();
  const headers = new Headers(init.headers);
  const localeHeaders = getLocaleRequestHeaders(resolveRequestLocale());
  for (const [headerName, headerValue] of Object.entries(localeHeaders)) {
    if (!headers.has(headerName)) {
      headers.set(headerName, headerValue);
    }
  }

  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return fetch(buildApiUrl(path), {
    ...init,
    headers,
    credentials: "include",
  });
};

const getCallerFrames = () => {
  const stack = new Error().stack?.split("\n") ?? [];
  const frames = stack.slice(1).map((line) => line.trim());
  const filtered = frames.filter((line) => {
    return !line.includes("/config/api.ts") && !line.includes("config/api.ts");
  });
  return {
    caller3: filtered[2] ?? "",
    caller4: filtered[3] ?? "",
  };
};

export const apiFetch = (path: string, init: RequestInit = {}) => {
  if (useProxy && path !== "/api/system") {
    const { caller3, caller4 } = getCallerFrames();
    const method = (init.method ?? "GET").toUpperCase();
    console.groupCollapsed(`[api] ${method} ${path}`);
    if (caller3) {
      console.log("caller3:", caller3);
    }
    if (caller4) {
      console.log("caller4:", caller4);
    }
    console.groupEnd();
  }
  if (!hasSessionCookie() && !hasSessionBootstrap()) {
    return ensureSystemSession().then(() => fetchWithCredentials(path, init));
  }
  return fetchWithCredentials(path, init);
};

const hasSessionCookie = () =>
  document.cookie.split(";").some((item) => item.trim().startsWith("zeus_session_id="));

const sessionBootstrapKey = "zeus.session.bootstrap";
let sessionBootstrapped = false;

const hasSessionBootstrap = () => {
  if (sessionBootstrapped) {
    return true;
  }
  try {
    return sessionStorage.getItem(sessionBootstrapKey) === "1";
  } catch {
    return false;
  }
};

const markSessionBootstrap = () => {
  sessionBootstrapped = true;
  try {
    sessionStorage.setItem(sessionBootstrapKey, "1");
  } catch {
    // ignore storage failures
  }
};

let sessionPromise: Promise<void> | null = null;
let generalSettingsBootstrapPromise: Promise<void> | null = null;

export const ensureSystemSession = async () => {
  if (hasSessionCookie() || hasSessionBootstrap()) {
    return;
  }
  if (!sessionPromise) {
    sessionPromise = fetchWithCredentials("/api/system", { method: "GET" })
      .then((response) => {
        if (response.ok) {
          markSessionBootstrap();
        }
      })
      .finally(() => {
        sessionPromise = null;
      });
  }
  await sessionPromise;
};

export const bootstrapGeneralSettings = async () => {
  if (generalSettingsBootstrapPromise) {
    return generalSettingsBootstrapPromise;
  }

  generalSettingsBootstrapPromise = (async () => {
    try {
      const response = await fetchWithCredentials("/api/settings/general", { method: "GET" });
      if (!response.ok) {
        return;
      }
      const payload = await response.json().catch(() => null);
      const data = payload?.data ?? payload ?? {};
      const enabled = Boolean(data.useRemoteKnowledgeBase ?? false);
      setRemoteKnowledgeBaseEnabled(enabled);
    } catch {
      // Ignore bootstrap failures and keep existing local value.
    } finally {
      generalSettingsBootstrapPromise = null;
    }
  })();

  await generalSettingsBootstrapPromise;
};
