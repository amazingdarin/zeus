import { apiFetch, buildApiUrl } from "../config/api";

export type SystemDocTreeItem = {
  type: "file" | "dir";
  name: string;
  path: string;
  children?: SystemDocTreeItem[];
  languages?: string[];
};

export type SystemDocContent = {
  path: string;
  content: string;
  language?: string;
  resolvedPath?: string;
};

export const fetchSystemDocsTree = async (language = "en"): Promise<SystemDocTreeItem[]> => {
  const params = new URLSearchParams();
  params.set("lang", language);
  const response = await apiFetch(`/api/app/system-docs/tree?${params.toString()}`);
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message || "Failed to load system docs tree");
  }
  const payload = await response.json().catch(() => null);
  return Array.isArray(payload?.data) ? payload.data : [];
};

export const fetchSystemDocContent = async (
  docPath: string,
  language = "en",
): Promise<SystemDocContent> => {
  const params = new URLSearchParams();
  params.set("path", docPath);
  params.set("lang", language);

  const response = await apiFetch(`/api/app/system-docs/content?${params.toString()}`);
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message || "Failed to load system doc");
  }

  const payload = await response.json().catch(() => null);
  const data = payload?.data ?? {};
  return {
    path: String(data.path ?? docPath),
    content: String(data.content ?? ""),
    language: typeof data.language === "string" ? data.language : undefined,
    resolvedPath: typeof data.resolvedPath === "string" ? data.resolvedPath : undefined,
  };
};

export const buildSystemDocAssetUrl = (assetPath: string): string => {
  const params = new URLSearchParams();
  params.set("path", assetPath);
  return buildApiUrl(`/api/app/system-docs/asset?${params.toString()}`);
};
