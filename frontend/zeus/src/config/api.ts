const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").trim();
const useProxy = Boolean(import.meta.env.DEV && apiBaseUrl);

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");
const trimLeadingSlash = (value: string) => value.replace(/^\/+/, "");

export const buildApiUrl = (path: string) => {
  const normalizedPath = `/${trimLeadingSlash(path)}`;
  if (useProxy || !apiBaseUrl) {
    return normalizedPath;
  }
  return `${trimTrailingSlash(apiBaseUrl)}${normalizedPath}`;
};

const fetchWithCredentials = (path: string, init: RequestInit = {}) => {
  return fetch(buildApiUrl(path), { ...init, credentials: "include" });
};

export const apiFetch = (path: string, init: RequestInit = {}) => {
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
