const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").trim();

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");
const trimLeadingSlash = (value: string) => value.replace(/^\/+/, "");

export const buildApiUrl = (path: string) => {
  const normalizedPath = `/${trimLeadingSlash(path)}`;
  if (!apiBaseUrl) {
    return normalizedPath;
  }
  return `${trimTrailingSlash(apiBaseUrl)}${normalizedPath}`;
};
