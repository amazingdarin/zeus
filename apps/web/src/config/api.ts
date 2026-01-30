const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").trim();
const appBackendUrl = (import.meta.env.VITE_APP_BACKEND_URL ?? "http://localhost:4870").trim();
const useProxy = Boolean(import.meta.env.DEV);

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");
const trimLeadingSlash = (value: string) => value.replace(/^\/+/, "");

/**
 * Check if a path should be routed to app-backend
 */
const isAppBackendPath = (path: string): boolean => {
  // Explicit app-backend prefix
  if (path.startsWith("/api/app")) return true;
  // Document operations now handled by app-backend
  if (path.match(/^\/api\/projects\/[^/]+\/documents/)) return true;
  // Knowledge search
  if (path.match(/^\/api\/projects\/[^/]+\/knowledge/)) return true;
  // Asset operations
  if (path.match(/^\/api\/projects\/[^/]+\/assets/)) return true;
  return false;
};

export const buildApiUrl = (path: string) => {
  const normalizedPath = `/${trimLeadingSlash(path)}`;
  
  if (isAppBackendPath(normalizedPath)) {
    // Route to app-backend
    const appPath = normalizedPath.startsWith("/api/app")
      ? normalizedPath.replace("/api/app", "/api")
      : normalizedPath;
    if (useProxy) {
      // In dev mode with proxy, use relative path
      return appPath;
    }
    return `${trimTrailingSlash(appBackendUrl)}${appPath}`;
  }
  
  // Route to Go server (projects, system, etc.)
  if (useProxy || !apiBaseUrl) {
    return normalizedPath;
  }
  return `${trimTrailingSlash(apiBaseUrl)}${normalizedPath}`;
};

const fetchWithCredentials = (path: string, init: RequestInit = {}) => {
  return fetch(buildApiUrl(path), { ...init, credentials: "include" });
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
