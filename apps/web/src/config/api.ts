const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").trim();
const appBackendUrl = (import.meta.env.VITE_APP_BACKEND_URL ?? "http://localhost:4870").trim();
const serverUrl = (import.meta.env.VITE_SERVER_URL ?? "http://localhost:8080").trim();
const useProxy = Boolean(import.meta.env.DEV);

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

export const buildApiUrl = (path: string) => {
  const normalizedPath = `/${trimLeadingSlash(path)}`;

  if (isAppBackendPath(normalizedPath)) {
    const appPath = normalizedPath.startsWith("/api/app")
      ? normalizedPath.replace("/api/app", "/api")
      : normalizedPath;
    if (useProxy) {
      return appPath;
    }
    return `${trimTrailingSlash(appBackendUrl)}${appPath}`;
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
  if (import.meta.env.DEV && path !== "/api/system") {
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
